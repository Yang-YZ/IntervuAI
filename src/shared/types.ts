export interface Scheduler {
  id: string;
  title: string;
  description?: string;
  created_at: string;
  updated_at: string;
  status: 'waiting_for_availability' | 'scheduling' | 'scheduled' | 'completed' | 'cancelled';
  scheduled_time?: string;
  timezone: string;
  interview_duration: number; // Duration in minutes
  interviewer_count: number; // Number of interviewers expected
}

export interface User {
  id: string;
  scheduler_id: string;
  name: string;
  email: string;
  role: 'candidate' | 'interviewer';
  timezone?: string; // Optional timezone from most recent availability record
  created_at: string;
  updated_at: string;
}

export interface Availability {
  id: string;
  user_id: string;
  scheduler_id: string;
  time_slots: TimeSlot[]; // Array of time slots with date-time info
  timezone: string; // User's timezone when they submitted
  created_at: string;
  updated_at: string;
}

// Legacy interface for compatibility with scheduler service
export interface LegacyAvailability {
  id: string;
  user_id: string;
  scheduler_id: string;
  date: string; // YYYY-MM-DD format
  time_slots: TimeSlot[];
  timezone?: string;
  created_at: string;
  updated_at: string;
}

export interface TimeSlot {
  date: string;  // YYYY-MM-DD format
  start: string; // HH:MM format
  end: string;   // HH:MM format
}

export interface ScheduleRequest {
  scheduler_id: string;
  timezone: string;
  interview_duration: number; // Duration in minutes
  candidate_availability: LegacyAvailability[];
  interviewer_availability: LegacyAvailability[]; // Can contain multiple interviewers
  users?: User[]; // User information for mapping IDs to names
}

export interface ScheduleResponse {
  success: boolean;
  scheduled_time?: string;
  message: string;
  suggested_times?: string[];
  all_available_slots?: {
    date: string;
    start_time: string;
    end_time: string;
    score: number;
    reasons: string[];
    scheduled_time: string;
  }[];
  availability_summary?: {
    candidate: {
      total_days: number;
      total_slots: number;
      availability_by_date: {
        date: string;
        slots: {
          start: string;
          end: string;
          duration_minutes: number;
        }[];
      }[];
    };
    interviewers: {
      total_interviewers: number;
      total_days: number;
      total_slots: number;
      availability_by_date: {
        date: string;
        slots: {
          start: string;
          end: string;
          duration_minutes: number;
        }[];
      }[];
    };
    overlapping_days: string[];
  };
  individual_interviews?: {
    interviewer_id: string;
    interviewer_name: string;
    date: string;
    start_time: string;
    end_time: string;
    score: number;
    reasons: string[];
    scheduled_time: string;
  }[];
}

export interface EmailNotification {
  to: string;
  subject: string;
  html: string;
  scheduler_id: string;
}


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