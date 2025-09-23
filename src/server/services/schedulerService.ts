import { Availability, TimeSlot, ScheduleRequest, ScheduleResponse, User } from '../../shared/types';
import { format, parseISO, addMinutes, isAfter, isBefore, isSameDay, differenceInMinutes } from 'date-fns';
import { utcToZonedTime, zonedTimeToUtc } from 'date-fns-tz';

export interface SchedulingOptions {
  duration: number; // in minutes
  bufferTime: number; // buffer between meetings in minutes
  businessHours: {
    start: string; // HH:MM format
    end: string;   // HH:MM format
  };
  preferredDays: number[]; // 0 = Sunday, 1 = Monday, etc.
  maxSuggestions: number;
}

export interface TimeSlotMatch {
  date: string;
  startTime: string;
  endTime: string;
  duration: number;
  score: number; // 0-100, higher is better
  reasons: string[];
  interviewer_id?: string;
  interviewer_name?: string;
}

export class SchedulerService {
  private defaultOptions: SchedulingOptions = {
    duration: 60, // 1 hour
    bufferTime: 15, // 15 minutes buffer
    businessHours: {
      start: '09:00',
      end: '17:00'
    },
    preferredDays: [1, 2, 3, 4, 5], // Monday to Friday
    maxSuggestions: 5
  };

  /**
   * Find the best time slot for an interview based on availability
   */
  async findOptimalSchedule(
    request: ScheduleRequest,
    options: Partial<SchedulingOptions> = {}
  ): Promise<ScheduleResponse> {
    try {
      const opts = { 
        ...this.defaultOptions, 
        ...options,
        duration: request.interview_duration || this.defaultOptions.duration
      };
      
      const individualInterviews = this.findIndividualInterviews(
        request.candidate_availability,
        request.interviewer_availability,
        opts,
        request.users
      );

      if (individualInterviews.length === 0) {
        return {
          success: false,
          message: 'No overlapping time slots found between candidate and any interviewer.'
        };
      }

      const primaryInterview = individualInterviews[0];
      // Get timezone from the candidate's availability data
      const candidateTimezone = request.candidate_availability.length > 0 ? 
        request.candidate_availability[0].timezone || request.timezone : 
        request.timezone;
      const scheduledTime = this.createScheduledTime(primaryInterview, candidateTimezone);

      return {
        success: true,
        scheduled_time: scheduledTime,
        message: this.formatMultipleInterviewsMessage(individualInterviews, candidateTimezone),
        suggested_times: individualInterviews.slice(1, opts.maxSuggestions).map(slot => 
          this.createScheduledTime(slot, candidateTimezone)
        ),
        all_available_slots: individualInterviews.map(slot => ({
          date: slot.date,
          start_time: slot.startTime,
          end_time: slot.endTime,
          score: slot.score,
          reasons: slot.reasons,
          scheduled_time: this.createScheduledTime(slot, request.timezone),
          interviewer_id: slot.interviewer_id,
          interviewer_name: slot.interviewer_name
        })),
        availability_summary: this.generateAvailabilitySummary(request),
        individual_interviews: individualInterviews.map(interview => ({
          interviewer_id: interview.interviewer_id || 'unknown',
          interviewer_name: interview.interviewer_name || 'Unknown Interviewer',
          date: interview.date,
          start_time: interview.startTime,
          end_time: interview.endTime,
          score: interview.score,
          reasons: interview.reasons,
          scheduled_time: this.createScheduledTime(interview, request.timezone)
        }))
      };

    } catch (error) {
      console.error('Scheduling error:', error);
      return {
        success: false,
        message: 'Failed to generate schedule. Please try again or contact support.',
        suggested_times: []
      };
    }
  }

  /**
   * Find individual interviews between candidate and each interviewer
   */
  private   findIndividualInterviews(
    candidateAvailability: Availability[],
    interviewerAvailability: Availability[],
    options: SchedulingOptions,
    users?: User[]
  ): TimeSlotMatch[] {
    const allInterviews: TimeSlotMatch[] = [];

    // Group interviewer availability by user_id
    const interviewerMap = new Map<string, Availability[]>();
    interviewerAvailability.forEach(avail => {
      if (!interviewerMap.has(avail.user_id)) {
        interviewerMap.set(avail.user_id, []);
      }
      interviewerMap.get(avail.user_id)!.push(avail);
    });

    // Find interviews for each interviewer individually
    interviewerMap.forEach((interviewerAvails, interviewerId) => {
      const overlappingSlots = this.findOverlappingSlots(
        candidateAvailability,
        interviewerAvails,
        options
      );

      // Take the first available slot for this interviewer (brute force approach)
      if (overlappingSlots.length > 0) {
        const firstSlot = overlappingSlots[0];
        
        // Find the interviewer name from the users array
        const interviewer = users?.find((user: any) => user.id === interviewerId);
        const interviewerName = interviewer ? `${interviewer.name} (${interviewer.email})` : `Interviewer ${interviewerId.substring(0, 8)}`;
        
        allInterviews.push({
          ...firstSlot,
          interviewer_id: interviewerId,
          interviewer_name: interviewerName
        });
      }
    });

    return allInterviews;
  }

  /**
   * Find all overlapping time slots between candidate and interviewer availability
   */
  private findOverlappingSlots(
    candidateAvailability: Availability[],
    interviewerAvailability: Availability[],
    options: SchedulingOptions
  ): TimeSlotMatch[] {
    const overlappingSlots: TimeSlotMatch[] = [];

    // Create a map of candidate availability by date
    const candidateMap = new Map<string, TimeSlot[]>();
    candidateAvailability.forEach(avail => {
      // Group time slots by date since each time slot has its own date
      avail.time_slots.forEach(slot => {
        if (!candidateMap.has(slot.date)) {
          candidateMap.set(slot.date, []);
        }
        candidateMap.get(slot.date)!.push(slot);
      });
    });

    // Check each interviewer availability against candidate availability
    interviewerAvailability.forEach((interviewerAvail) => {
      interviewerAvail.time_slots.forEach((interviewerSlot) => {
        const candidateSlots = candidateMap.get(interviewerSlot.date);
        if (!candidateSlots) {
          return;
        }

        candidateSlots.forEach((candidateSlot) => {
          const overlaps = this.findTimeSlotOverlap(
            interviewerSlot,
            candidateSlot,
            options.duration
          );

          if (overlaps && overlaps.length > 0) {
            // Select the best time slot from the possible options
            const bestSlot = this.selectBestTimeSlot(overlaps);
            const timeSlotMatch = {
              date: interviewerSlot.date, // Use date from the interviewer slot
              startTime: bestSlot.start,
              endTime: bestSlot.end,
              duration: options.duration,
              score: 100,
              reasons: []
            };
            overlappingSlots.push(timeSlotMatch);
          }
        });
      });
    });

    return overlappingSlots;
  }

  /**
   * Find overlap between two time slots and generate multiple possible interview slots
   */
  private findTimeSlotOverlap(
    slot1: TimeSlot,
    slot2: TimeSlot,
    requiredDuration: number
  ): TimeSlot[] {
    const start1 = this.parseTime(slot1.start);
    const end1 = this.parseTime(slot1.end);
    const start2 = this.parseTime(slot2.start);
    const end2 = this.parseTime(slot2.end);

    // Find the overlap
    const overlapStart = this.maxTime(start1, start2);
    const overlapEnd = this.minTime(end1, end2);

    const overlapDuration = this.timeDifference(overlapStart, overlapEnd);

    // Check if there's enough time for the required duration
    if (overlapDuration < requiredDuration) {
      return [];
    }

    // Generate multiple possible interview slots within the overlapping period
    const possibleSlots: TimeSlot[] = [];
    const availableDuration = overlapDuration - requiredDuration;
    
    // If there's extra time, we can start at different points within the overlap
    // Generate slots starting every 15 minutes within the available window
    const intervalMinutes = Math.min(15, Math.max(1, Math.floor(availableDuration / 4)));
    
    for (let offset = 0; offset <= availableDuration; offset += intervalMinutes) {
      const slotStartTime = this.minutesToTime(overlapStart.totalMinutes + offset);
      const slotEndTime = this.addMinutesToTime(this.formatTime(slotStartTime), requiredDuration);
      
      // Make sure the slot doesn't exceed the overlap end time
      const slotEndParsed = this.parseTime(slotEndTime);
      if (slotEndParsed.totalMinutes <= overlapEnd.totalMinutes) {
        possibleSlots.push({
          date: slot1.date,
          start: this.formatTime(slotStartTime),
          end: slotEndTime
        });
      }
    }

    // If no flexible slots were generated (e.g., exact fit), return the first possible slot
    if (possibleSlots.length === 0) {
      const slotStartTime = overlapStart;
      const slotEndTime = this.addMinutesToTime(this.formatTime(overlapStart), requiredDuration);
      
      possibleSlots.push({
        date: slot1.date,
        start: this.formatTime(slotStartTime),
        end: slotEndTime
      });
    }
    
    return possibleSlots;
  }

  /**
   * Select the best time slot from multiple options
   * Prefers times that are on the hour or half-hour, but allows flexibility
   */
  private selectBestTimeSlot(slots: TimeSlot[]): TimeSlot {
    if (slots.length === 1) {
      return slots[0];
    }

    // Score each slot based on how "nice" the time is
    const scoredSlots = slots.map(slot => {
      const time = this.parseTime(slot.start);
      let score = 100; // Base score

      // Prefer times on the hour (minutes = 0)
      if (time.minutes === 0) {
        score += 20;
      }
      // Prefer times on the half-hour (minutes = 30)
      else if (time.minutes === 30) {
        score += 15;
      }
      // Prefer times on quarter hours (minutes = 0, 15, 30, 45)
      else if (time.minutes % 15 === 0) {
        score += 10;
      }
      // Prefer times on 5-minute intervals
      else if (time.minutes % 5 === 0) {
        score += 5;
      }

      // Prefer earlier times in the day (business hours preference)
      if (time.hours >= 9 && time.hours <= 17) {
        score += 10;
      }

      return { slot, score };
    });

    // Sort by score (highest first) and return the best one
    scoredSlots.sort((a, b) => b.score - a.score);
    return scoredSlots[0].slot;
  }

  /**
   * Create a scheduled time in ISO format
   */
  private createScheduledTime(slot: TimeSlotMatch, timezone: string): string {
    console.log('[createScheduledTime] Input slot:', slot);
    console.log('[createScheduledTime] Input timezone:', timezone);
    
    // Check if date is undefined and provide a fallback
    if (!slot.date) {
      console.error('[createScheduledTime] ERROR: slot.date is undefined!');
      // Use today's date as fallback
      const today = new Date();
      const fallbackDate = today.toISOString().split('T')[0]; // YYYY-MM-DD format
      slot.date = fallbackDate;
    }
    
    // Ensure the time format includes seconds
    const timeWithSeconds = slot.startTime.includes(':') && slot.startTime.split(':').length === 2 
      ? `${slot.startTime}:00` 
      : slot.startTime;
    
    console.log('[createScheduledTime] Time with seconds:', timeWithSeconds);
    
    const dateTimeString = `${slot.date}T${timeWithSeconds}`;
    console.log('[createScheduledTime] DateTime string:', dateTimeString);
    
    // Convert from local time to UTC for storage
    const zonedTime = zonedTimeToUtc(dateTimeString, timezone);
    console.log('[createScheduledTime] Zoned time:', zonedTime);
    
    const result = zonedTime.toISOString();
    console.log('[createScheduledTime] Final ISO string:', result);
    
    return result;
  }

  /**
   * Format a schedule message
   */
  private formatScheduleMessage(slot: TimeSlotMatch, timezone: string): string {
    const date = format(parseISO(slot.date), 'EEEE, MMMM do, yyyy');
    const time = `${slot.startTime} - ${slot.endTime}`;
    const reasons = slot.reasons.length > 0 ? ` (${slot.reasons.join(', ')})` : '';
    
    return `Interview scheduled for ${date} at ${time} ${timezone}${reasons}`;
  }

  /**
   * Format a message for multiple individual interviews
   */
  private formatMultipleInterviewsMessage(interviews: TimeSlotMatch[], timezone: string): string {
    if (interviews.length === 0) {
      return 'No interviews scheduled';
    }
    
    if (interviews.length === 1) {
      return this.formatScheduleMessage(interviews[0], timezone);
    }
    
    const interviewCount = interviews.length;
    const firstInterview = interviews[0];
    const date = format(parseISO(firstInterview.date), 'EEEE, MMMM do, yyyy');
    
    return `${interviewCount} individual interviews scheduled for ${date}. Check details below for specific times.`;
  }

  // Utility methods for time manipulation
  private parseTime(timeStr: string): { hours: number; minutes: number; totalMinutes: number } {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const totalMinutes = hours * 60 + minutes;
    return { hours, minutes, totalMinutes };
  }

  private formatTime(time: { hours: number; minutes: number }): string {
    return `${time.hours.toString().padStart(2, '0')}:${time.minutes.toString().padStart(2, '0')}`;
  }

  private maxTime(time1: { hours: number; minutes: number; totalMinutes: number }, time2: { hours: number; minutes: number; totalMinutes: number }): { hours: number; minutes: number; totalMinutes: number } {
    return time1.totalMinutes >= time2.totalMinutes ? time1 : time2;
  }

  private minTime(time1: { hours: number; minutes: number; totalMinutes: number }, time2: { hours: number; minutes: number; totalMinutes: number }): { hours: number; minutes: number; totalMinutes: number } {
    return time1.totalMinutes <= time2.totalMinutes ? time1 : time2;
  }

  private timeDifference(start: { hours: number; minutes: number; totalMinutes: number }, end: { hours: number; minutes: number; totalMinutes: number }): number {
    // Handle midnight crossing: if end time is earlier than start time, it means it's the next day
    if (end.totalMinutes < start.totalMinutes) {
      // Add 24 hours (1440 minutes) to the end time
      return (end.totalMinutes + 1440) - start.totalMinutes;
    }
    return end.totalMinutes - start.totalMinutes;
  }

  private minutesToTime(totalMinutes: number): { hours: number; minutes: number; totalMinutes: number } {
    // Normalize to 24-hour format (0-1439 minutes)
    const normalizedMinutes = totalMinutes % 1440;
    const hours = Math.floor(normalizedMinutes / 60);
    const minutes = normalizedMinutes % 60;
    return { hours, minutes, totalMinutes: normalizedMinutes };
  }

  private addMinutesToTime(timeStr: string, minutes: number): string {
    const time = this.parseTime(timeStr);
    const totalMinutes = time.totalMinutes + minutes;
    const newTime = this.minutesToTime(totalMinutes);
    return this.formatTime(newTime);
  }

  /**
   * Validate availability data
   */
  validateAvailability(availability: Availability[]): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!availability || availability.length === 0) {
      errors.push('No availability provided');
      return { valid: false, errors };
    }

    availability.forEach((avail, index) => {
      // Validate time slots
      if (!avail.time_slots || avail.time_slots.length === 0) {
        errors.push(`No time slots provided for availability at index ${index}`);
        return;
      }

      avail.time_slots.forEach((slot, slotIndex) => {
        // Validate date format in each time slot
        if (!/^\d{4}-\d{2}-\d{2}$/.test(slot.date)) {
          errors.push(`Invalid date format for availability ${index} slot ${slotIndex}: ${slot.date}`);
        }

        if (!this.isValidTimeFormat(slot.start) || !this.isValidTimeFormat(slot.end)) {
          errors.push(`Invalid time format for availability ${index} slot ${slotIndex}: ${slot.start}-${slot.end}`);
        }

        if (this.parseTime(slot.start).hours >= this.parseTime(slot.end).hours) {
          errors.push(`Invalid time range for availability ${index} slot ${slotIndex}: start time must be before end time`);
        }
      });
    });

    return { valid: errors.length === 0, errors };
  }

  private isValidTimeFormat(timeStr: string): boolean {
    return /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(timeStr);
  }

  /**
   * Generate detailed availability summary
   */
  private generateAvailabilitySummary(request: ScheduleRequest): any {
    // Group candidate availability by date
    const candidateDateMap = new Map<string, any[]>();
    request.candidate_availability.forEach(avail => {
      avail.time_slots.forEach(slot => {
        if (!candidateDateMap.has(slot.date)) {
          candidateDateMap.set(slot.date, []);
        }
        candidateDateMap.get(slot.date)!.push({
          start: slot.start,
          end: slot.end,
          duration_minutes: this.timeDifference(this.parseTime(slot.start), this.parseTime(slot.end))
        });
      });
    });

    // Group interviewer availability by date
    const interviewerDateMap = new Map<string, any[]>();
    request.interviewer_availability.forEach(avail => {
      avail.time_slots.forEach(slot => {
        if (!interviewerDateMap.has(slot.date)) {
          interviewerDateMap.set(slot.date, []);
        }
        interviewerDateMap.get(slot.date)!.push({
          start: slot.start,
          end: slot.end,
          duration_minutes: this.timeDifference(this.parseTime(slot.start), this.parseTime(slot.end))
        });
      });
    });

    const summary = {
      candidate: {
        total_days: candidateDateMap.size,
        total_slots: request.candidate_availability.reduce((sum, avail) => sum + avail.time_slots.length, 0),
        availability_by_date: Array.from(candidateDateMap.entries()).map(([date, slots]) => ({
          date,
          slots
        }))
      },
      interviewers: {
        total_interviewers: request.interviewer_availability.length,
        total_days: interviewerDateMap.size,
        total_slots: request.interviewer_availability.reduce((sum, avail) => sum + avail.time_slots.length, 0),
        availability_by_date: Array.from(interviewerDateMap.entries()).map(([date, slots]) => ({
          date,
          slots
        }))
      },
      overlapping_days: this.findOverlappingDays(request.candidate_availability, request.interviewer_availability)
    };

    return summary;
  }

  /**
   * Find overlapping days between candidate and interviewer availability
   */
  private findOverlappingDays(candidateAvailability: Availability[], interviewerAvailability: Availability[]): string[] {
    // Extract all dates from time slots in candidate availability
    const candidateDates = new Set<string>();
    candidateAvailability.forEach(avail => {
      avail.time_slots.forEach(slot => {
        candidateDates.add(slot.date);
      });
    });

    // Extract all dates from time slots in interviewer availability
    const interviewerDates = new Set<string>();
    interviewerAvailability.forEach(avail => {
      avail.time_slots.forEach(slot => {
        interviewerDates.add(slot.date);
      });
    });

    return Array.from(candidateDates).filter(date => interviewerDates.has(date));
  }

  /**
   * Get scheduling statistics
   */
  getSchedulingStats(
    candidateAvailability: Availability[],
    interviewerAvailability: Availability[]
  ): {
    totalCandidateSlots: number;
    totalInterviewerSlots: number;
    overlappingDays: number;
    totalOverlappingHours: number;
  } {
    const candidateSlots = candidateAvailability.reduce((sum, avail) => sum + avail.time_slots.length, 0);
    const interviewerSlots = interviewerAvailability.reduce((sum, avail) => sum + avail.time_slots.length, 0);
    
    // Extract dates from time slots
    const candidateDates = new Set<string>();
    candidateAvailability.forEach(avail => {
      avail.time_slots.forEach(slot => {
        candidateDates.add(slot.date);
      });
    });
    
    const interviewerDates = new Set<string>();
    interviewerAvailability.forEach(avail => {
      avail.time_slots.forEach(slot => {
        interviewerDates.add(slot.date);
      });
    });
    
    const overlappingDays = new Set([...candidateDates].filter(date => interviewerDates.has(date))).size;
    
    const overlappingSlots = this.findOverlappingSlots(candidateAvailability, interviewerAvailability, this.defaultOptions);
    const totalOverlappingHours = overlappingSlots.reduce((sum, slot) => sum + slot.duration, 0) / 60;

    return {
      totalCandidateSlots: candidateSlots,
      totalInterviewerSlots: interviewerSlots,
      overlappingDays,
      totalOverlappingHours
    };
  }
}
