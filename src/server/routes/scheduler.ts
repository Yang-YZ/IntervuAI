import express, { Request, Response } from 'express';
import { utcToZonedTime, format } from 'date-fns-tz';
import { v4 as uuidv4 } from 'uuid';
import { body, param, validationResult } from 'express-validator';
import { SchedulerService } from '../services/schedulerService';

const router = express.Router();

// Helper function to get latest availability record per user
function getLatestAvailabilityPerUser(availabilityRecords: any[]): any[] {
  if (!availabilityRecords || availabilityRecords.length === 0) {
    return [];
  }
  
  // Group by user_id and date, get the latest record for each user-date combination
  const userDateMap = new Map<string, any>();
  
  availabilityRecords.forEach(record => {
    const key = `${record.user_id}-${record.date}`;
    const existingRecord = userDateMap.get(key);
    if (!existingRecord || new Date(record.updated_at) > new Date(existingRecord.updated_at)) {
      userDateMap.set(key, record);
    }
  });
  
  return Array.from(userDateMap.values());
}

function getMostRecentAvailabilitySubmission(availabilityRecords: any[]): any[] {
  console.log(`[getMostRecentAvailabilitySubmission] Input records:`, availabilityRecords.length);
  if (!availabilityRecords || availabilityRecords.length === 0) {
    return [];
  }
  
  // Check if we have new schema (time_slots with date) or old schema (date/time_slots)
  const firstRecord = availabilityRecords[0];
  const hasNewSchema = firstRecord.time_slots && Array.isArray(firstRecord.time_slots) && 
                      firstRecord.time_slots.length > 0 && firstRecord.time_slots[0].date;
  const hasOldSchema = firstRecord.date && firstRecord.time_slots;
  
  console.log(`[getMostRecentAvailabilitySubmission] Schema detection - New: ${hasNewSchema}, Old: ${hasOldSchema}`);
  
  if (hasNewSchema) {
    // With new schema, each record is already one complete submission per user
    // Just get the most recent record for each user
    const userLatestMap = new Map<string, any>();
    
    availabilityRecords.forEach(record => {
      const userId = record.user_id;
      const existingRecord = userLatestMap.get(userId);
      if (!existingRecord || new Date(record.updated_at) > new Date(existingRecord.updated_at)) {
        userLatestMap.set(userId, record);
      }
    });
    
    console.log(`[getMostRecentAvailabilitySubmission] Latest records per user:`, userLatestMap.size);
    
    // Convert the time_slots back to the old format for compatibility
    const result: any[] = [];
    userLatestMap.forEach((record) => {
      // Group time slots by date
      const dateMap = new Map<string, any[]>();
      if (record.time_slots) {
        console.log('[getMostRecentAvailabilitySubmission] record.time_slots:', record.time_slots);
        
        // Handle both array and single object formats
        const timeSlotsArray = Array.isArray(record.time_slots) ? record.time_slots : [record.time_slots];
        
        timeSlotsArray.forEach((slot: any) => {
          console.log('[getMostRecentAvailabilitySubmission] slot:', slot);
          
          // Use the date from the slot if available, otherwise use the record's date
          const slotDate = slot.date || record.date;
          if (!slotDate) {
            console.log('[getMostRecentAvailabilitySubmission] No date found for slot:', slot);
            return;
          }
          
          if (!dateMap.has(slotDate)) {
            dateMap.set(slotDate, []);
          }
          
          // Use the stored local times directly (no conversion needed)
          let startTime = slot.start;
          let endTime = slot.end;
          
          // If start/end are ISO datetime strings (legacy data), extract just the time part
          if (typeof slot.start === 'string' && slot.start.includes('T')) {
            const startDate = new Date(slot.start);
            startTime = startDate.toISOString().substring(11, 16); // Extract HH:MM
          }
          if (typeof slot.end === 'string' && slot.end.includes('T')) {
            const endDate = new Date(slot.end);
            endTime = endDate.toISOString().substring(11, 16); // Extract HH:MM
          }
          
          dateMap.get(slotDate)!.push({
            start: startTime,
            end: endTime
          });
        });
        
        // Create individual date records
        dateMap.forEach((timeSlots, date) => {
          result.push({
            id: record.id,
            user_id: record.user_id,
            scheduler_id: record.scheduler_id,
            date: date,
            time_slots: timeSlots,
            timezone: record.timezone,
            created_at: record.created_at,
            updated_at: record.updated_at
          });
        });
      }
    });
    
    console.log(`[getMostRecentAvailabilitySubmission] Expanded result:`, result.length);
    return result;
  } else if (hasOldSchema) {
    // Old schema - group by user_id and get most recent submission
    console.log(`[getMostRecentAvailabilitySubmission] Using old schema logic`);
    const userLatestMap = new Map<string, any>();
    
    availabilityRecords.forEach(record => {
      const userId = record.user_id;
      const existingRecord = userLatestMap.get(userId);
      if (!existingRecord || new Date(record.updated_at) > new Date(existingRecord.updated_at)) {
        userLatestMap.set(userId, record);
      }
    });
    
    // Get all records from the most recent submission for each user
    const result: any[] = [];
    userLatestMap.forEach((latestRecord) => {
      const userLatestSubmissionTime = latestRecord.updated_at;
      const userLatestSubmission = availabilityRecords.filter(record => 
        record.user_id === latestRecord.user_id && 
        record.updated_at === userLatestSubmissionTime
      );
      result.push(...userLatestSubmission);
    });
    
    console.log(`[getMostRecentAvailabilitySubmission] Old schema result:`, result.length);
    return result;
  } else {
    console.log(`[getMostRecentAvailabilitySubmission] Unknown schema format`);
    return availabilityRecords;
  }
}

// Create a new scheduler
router.post('/create', [
  body('title').notEmpty().withMessage('Title is required'),
  body('description').optional().isString(),
  body('timezone').optional().isString().default('UTC'),
  body('interview_duration').optional().isInt({ min: 15, max: 180 }).withMessage('Interview duration must be between 15 and 180 minutes'),
  body('interviewer_count').optional().isInt({ min: 1, max: 10 }).withMessage('Interviewer count must be between 1 and 10')
], async (req: Request, res: Response): Promise<void> => {
  try {
    console.log('[Scheduler][POST /create] Incoming request body:', req.body);
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.warn('[Scheduler][POST /create] Validation errors:', errors.array());
      res.status(400).json({ errors: errors.array() });
      return;
    }

    // Ensure database is initialized
    await req.database.initialize();
    console.log('[Scheduler][POST /create] Database initialized.');

    const { title, description, timezone = 'UTC', interview_duration = 60, interviewer_count = 1 } = req.body;
    const schedulerId = uuidv4();

    // Ensure all values are defined
    const schedulerData = {
      id: schedulerId,
      title: title || '',
      description: description || undefined,
      status: 'waiting_for_availability' as const,
      scheduled_time: undefined,
      timezone: timezone || 'UTC',
      interview_duration: interview_duration || 60,
      interviewer_count: interviewer_count || 1
    };

    console.log('[Scheduler][POST /create] Creating scheduler with data:', schedulerData);

    const scheduler = req.database.createScheduler(schedulerData);
    console.log('[Scheduler][POST /create] Scheduler created in DB:', scheduler);

    res.status(201).json({
      success: true,
      scheduler: {
        id: scheduler.id,
        title: scheduler.title,
        description: scheduler.description,
        timezone: scheduler.timezone,
        status: scheduler.status
      }
    });
    console.log('[Scheduler][POST /create] Response sent.');
  } catch (error) {
    console.error('[Scheduler][POST /create] Error creating scheduler:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('[Scheduler][POST /create] Error details:', errorMessage);
    console.error('[Scheduler][POST /create] Stack trace:', errorStack);
    res.status(500).json({ error: 'Failed to create scheduler', details: errorMessage });
  }
});

// Get scheduler by ID
router.get('/:id', [
  param('id').notEmpty().withMessage('ID is required')
], async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    // Ensure database is initialized
    await req.database.initialize();

  const { id } = req.params;
  const tz = (req.query.tz as string) || 'UTC';
  const scheduler = req.database.getSchedulerById(id);

    console.log('[GET /scheduler/:uuid] Scheduler from DB:', scheduler);

    if (!scheduler) {
      res.status(404).json({ error: 'Scheduler not found' });
      return;
    }

    // Get users for this scheduler
    const users = req.database.getUsersBySchedulerId(scheduler.id);
    
    // Get availability for this scheduler - use most recent submission overall
    let allAvailability = req.database.getAvailabilityBySchedulerId(scheduler.id);
    let availability = getMostRecentAvailabilitySubmission(allAvailability);
    
    // Time slots are already stored as local times, no conversion needed
    // if (tz) {
    //   availability = availability.map((a: any) => {
    //     const slots = Array.isArray(a.time_slots) ? a.time_slots : [];
    //     const converted = slots.map((slot: any) => {
    //       const startLocal = format(utcToZonedTime(slot.start, tz), 'HH:mm', { timeZone: tz });
    //       const endLocal = format(utcToZonedTime(slot.end, tz), 'HH:mm', { timeZone: tz });
    //       return { start: startLocal, end: endLocal };
    //     });
    //     return { ...a, time_slots: converted };
    //   });
    // }

    // Normalize any array/Uint8-like values to strings
    const normalize = (obj: any) => {
      const out: any = {};
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (v && typeof v === 'object') {
          // Uint8Array from sql.js or arrays
          if (typeof (global as any).TextDecoder === 'function' && v instanceof Uint8Array) {
            out[k] = new (global as any).TextDecoder('utf-8').decode(v);
          } else if (Array.isArray(v)) {
            out[k] = v.length > 0 ? v[0] : '';
          } else {
            out[k] = v;
          }
        } else {
          out[k] = v;
        }
      }
      return out;
    };

    const cleanedScheduler = normalize(scheduler);
    const cleanedUsers = Array.isArray(users) ? users.map(u => normalize(u)) : users;
    const cleanedAvailability = Array.isArray(availability) ? availability.map(a => normalize(a)) : availability;

    const responseData = {
      success: true,
      scheduler: {
        ...cleanedScheduler,
        users: cleanedUsers,
        availability: cleanedAvailability
      }
    };

    console.log('[GET /scheduler/:uuid] Sending cleaned response data:', JSON.stringify(responseData, null, 2));

    res.json(responseData);
  } catch (error) {
    console.error('Error fetching scheduler:', error);
    res.status(500).json({ error: 'Failed to fetch scheduler' });
  }
});

// Update scheduler status
router.patch('/:id/status', [
  param('id').notEmpty().withMessage('ID is required'),
  body('status').isIn(['waiting_for_availability', 'scheduling', 'scheduled', 'completed', 'cancelled']),
  body('scheduled_time').optional().isISO8601()
], async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    // Ensure database is initialized
    await req.database.initialize();

    const { id } = req.params;
    const { status, scheduled_time } = req.body;

    const scheduler = req.database.getSchedulerById(id);
    if (!scheduler) {
      res.status(404).json({ error: 'Scheduler not found' });
      return;
    }

    req.database.updateSchedulerStatus(scheduler.id, status, scheduled_time);

    res.json({
      success: true,
      message: 'Scheduler status updated successfully'
    });
  } catch (error) {
    console.error('Error updating scheduler status:', error);
    res.status(500).json({ error: 'Failed to update scheduler status' });
  }
});

// Generate schedule using LLM
router.post('/:id/generate-schedule', [
  param('id').notEmpty().withMessage('ID is required')
], async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    // Ensure database is initialized
    await req.database.initialize();

    const { id } = req.params;
    const scheduler = req.database.getSchedulerById(id);

    if (!scheduler) {
      res.status(404).json({ error: 'Scheduler not found' });
      return;
    }

    // Get users and availability
    const users = req.database.getUsersBySchedulerId(scheduler.id);
    const availability = req.database.getAvailabilityBySchedulerId(scheduler.id);

    // Check if we have candidate and at least one interviewer
    const candidate = users.find((u: any) => u.role === 'candidate');
    const interviewers = users.filter((u: any) => u.role === 'interviewer');

    if (!candidate || interviewers.length === 0) {
      res.status(400).json({ 
        error: 'Candidate and at least one interviewer must be registered' 
      });
      return;
    }

    // Check if candidate and all interviewers have availability - use latest records per user
    const candidateAvailability = getLatestAvailabilityPerUser(availability.filter((a: any) => a.user_id === candidate.id));
    const interviewerAvailability = getLatestAvailabilityPerUser(availability.filter((a: any) => 
      interviewers.some((interviewer: any) => interviewer.id === a.user_id)
    ));


    if (candidateAvailability.length === 0 || interviewerAvailability.length === 0) {
      res.status(400).json({ 
        error: 'Candidate and all interviewers must provide availability' 
      });
      return;
    }

    // Time slots are already stored as local times in HH:mm format, no conversion needed
    const convertSlots = (arr: any[]) => arr.map(a => ({
      ...a,
      time_slots: (Array.isArray(a.time_slots) ? a.time_slots : []).map((s: any) => ({
        date: s.date, // Preserve the date field
        start: s.start, // Already in HH:mm format
        end: s.end // Already in HH:mm format
      }))
    }));

    const scheduleRequest = {
      scheduler_id: scheduler.id,
      timezone: scheduler.timezone,
      interview_duration: scheduler.interview_duration || 60,
      candidate_availability: convertSlots(candidateAvailability),
      interviewer_availability: convertSlots(interviewerAvailability),
      users: users // Pass user information for name mapping
    };

    // Use code-based scheduler instead of LLM
    const schedulerService = new SchedulerService();
    const scheduleResponse = await schedulerService.findOptimalSchedule(scheduleRequest);

    if (scheduleResponse.success && scheduleResponse.scheduled_time) {
      // Update scheduler with scheduled time
      req.database.updateSchedulerStatus(
        scheduler.id, 
        'scheduled', 
        scheduleResponse.scheduled_time
      );

      // Send confirmation emails
      const emails = req.emailService.generateScheduleConfirmationEmail(
        scheduler.id,
        scheduleResponse.scheduled_time,
        scheduler.timezone,
        candidate.name,
        interviewers.map(i => i.name).join(', '),
        candidate.email,
        interviewers.map(i => i.email).join(',')
      );

      await Promise.all([
        req.emailService.sendEmail(emails.candidate),
        ...interviewers.map(interviewer => 
          req.emailService.sendEmail({
            ...emails.interviewer,
            to: interviewer.email
          })
        )
      ]);
    } else {
      // Send availability request emails
      const emails = req.emailService.generateAvailabilityRequestEmail(
        scheduler.id,
        candidate.name,
        interviewers.map(i => i.name).join(', '),
        candidateAvailability,
        interviewerAvailability,
        scheduler.timezone,
        candidate.email,
        interviewers.map(i => i.email).join(','),
        scheduleResponse.message
      );

      await Promise.all([
        req.emailService.sendEmail(emails.candidate),
        ...interviewers.map(interviewer => 
          req.emailService.sendEmail({
            ...emails.interviewer,
            to: interviewer.email
          })
        )
      ]);
    }

    res.json({
      success: true,
      schedule: scheduleResponse,
      message: scheduleResponse.success 
        ? 'Schedule generated and emails sent successfully'
        : 'No suitable time found. Availability request emails sent.'
    });

  } catch (error) {
    console.error('Error generating schedule:', error);
    res.status(500).json({ error: 'Failed to generate schedule' });
  }
});

// Get scheduling statistics for a scheduler
router.get('/:id/stats', [
  param('id').notEmpty().withMessage('ID is required')
], async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { id } = req.params;

    // Get scheduler
    const scheduler = req.database.getSchedulerById(id);
    if (!scheduler) {
      res.status(404).json({ error: 'Scheduler not found' });
      return;
    }

    // Get all availability for this scheduler
    const allAvailability = req.database.getAvailabilityBySchedulerId(scheduler.id);
    if (!allAvailability || allAvailability.length === 0) {
      res.status(404).json({ error: 'No availability found for this scheduler' });
      return;
    }

    // Get all users for this scheduler
    const allUsers = req.database.getUsersBySchedulerId(scheduler.id);
    const userMap = new Map(allUsers.map(user => [user.id, user]));

    // Separate candidate and interviewer availability - use latest records per user
    const candidateAvailability = getLatestAvailabilityPerUser(allAvailability.filter((avail: any) => {
      const user = userMap.get(avail.user_id);
      return user && user.role === 'candidate';
    }));

    const interviewerAvailability = getLatestAvailabilityPerUser(allAvailability.filter((avail: any) => {
      const user = userMap.get(avail.user_id);
      return user && user.role === 'interviewer';
    }));

    if (candidateAvailability.length === 0 || interviewerAvailability.length === 0) {
      res.status(400).json({ error: 'Both candidate and interviewer availability required' });
      return;
    }

    // Time slots are already stored as local times in HH:mm format, no conversion needed
    const convertSlots = (arr: any[]) => arr.map(a => ({
      ...a,
      time_slots: (Array.isArray(a.time_slots) ? a.time_slots : []).map((s: any) => ({
        date: s.date, // Preserve the date field
        start: s.start, // Already in HH:mm format
        end: s.end // Already in HH:mm format
      }))
    }));

    const schedulerService = new SchedulerService();
    const stats = schedulerService.getSchedulingStats(
      convertSlots(candidateAvailability),
      convertSlots(interviewerAvailability)
    );

    res.json({
      success: true,
      stats,
      scheduler: {
        id: scheduler.id,
        title: scheduler.title,
        status: scheduler.status,
        timezone: scheduler.timezone
      }
    });

  } catch (error) {
    console.error('Error getting scheduling stats:', error);
    res.status(500).json({ error: 'Failed to get scheduling statistics' });
  }
});

// Validate availability data
router.post('/validate-availability', [
  body('availability').isArray().withMessage('Availability must be an array'),
  body('availability.*.date').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Invalid date format'),
  body('availability.*.time_slots').isArray().withMessage('Time slots must be an array'),
  body('availability.*.time_slots.*.start').matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Invalid start time format'),
  body('availability.*.time_slots.*.end').matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Invalid end time format')
], async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { availability } = req.body;
    const schedulerService = new SchedulerService();
    const validation = schedulerService.validateAvailability(availability);

    res.json({
      success: validation.valid,
      valid: validation.valid,
      errors: validation.errors
    });

  } catch (error) {
    console.error('Error validating availability:', error);
    res.status(500).json({ error: 'Failed to validate availability' });
  }
});


// Get users for a scheduler
router.get('/:id/users', [
  param('id').notEmpty().withMessage('ID is required')
], async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { id } = req.params;
    const scheduler = req.database.getSchedulerById(id);

    if (!scheduler) {
      res.status(404).json({ error: 'Scheduler not found' });
      return;
    }

    const users = req.database.getUsersBySchedulerId(scheduler.id);

    // Get availability to extract timezone information
    const availability = req.database.getAvailabilityBySchedulerId(scheduler.id);
    
    res.json({
      success: true,
      users: users.map(user => {
        // Find the most recent availability for this user to get timezone
        const userAvailability = availability.filter((a: any) => a.user_id === user.id);
        const mostRecentAvailability = userAvailability.length > 0 ? userAvailability[userAvailability.length - 1] : null;
        
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          timezone: mostRecentAvailability?.timezone || scheduler.timezone || 'UTC'
        };
      })
    });

  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Check scheduling readiness status
router.get('/:id/status', [
  param('id').notEmpty().withMessage('ID is required')
], async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { id } = req.params;
    const scheduler = req.database.getSchedulerById(id);

    if (!scheduler) {
      res.status(404).json({ error: 'Scheduler not found' });
      return;
    }

    // Get users and availability
    const users = req.database.getUsersBySchedulerId(scheduler.id);
    const availability = req.database.getAvailabilityBySchedulerId(scheduler.id);

    // Check if we have candidate and at least one interviewer
    const candidate = users.find((u: any) => u.role === 'candidate');
    const interviewers = users.filter((u: any) => u.role === 'interviewer');
    console.log(`[status] Candidate object:`, candidate);
    // Get timezone from availability records
    const candidateAvailabilityRecord = candidate ? availability.find((a: any) => a.user_id === candidate.id) : null;
    const candidateTimezone = candidateAvailabilityRecord?.timezone || scheduler.timezone || 'UTC';
    console.log(`[status] Candidate timezone:`, candidateTimezone);

    // Check availability for each user - use most recent submission overall
    console.log(`[status] Raw availability records:`, availability.length);
    console.log(`[status] Raw availability for candidate ${candidate?.id}:`, availability.filter((a: any) => a.user_id === candidate?.id));
    
    const candidateAvailability = candidate ? getMostRecentAvailabilitySubmission(availability.filter((a: any) => a.user_id === candidate.id)) : [];
    const interviewerAvailability = getMostRecentAvailabilitySubmission(availability.filter((a: any) => 
      interviewers.some((interviewer: any) => interviewer.id === a.user_id)
    ));
    
    console.log(`[status] Processed candidate availability:`, candidateAvailability.length);
    console.log(`[status] Processed interviewer availability:`, interviewerAvailability.length);

    // Calculate readiness status
    const isReady = candidate && interviewers.length > 0 && 
                   candidateAvailability.length > 0 && 
                   interviewerAvailability.length > 0;

    // Calculate statistics and format time slots for display
    const totalSlots = candidateAvailability.reduce((sum: number, avail: any) => 
      sum + (Array.isArray(avail.time_slots) ? avail.time_slots.length : 0), 0) +
      interviewerAvailability.reduce((sum: number, avail: any) => 
        sum + (Array.isArray(avail.time_slots) ? avail.time_slots.length : 0), 0);

    const candidateDays = candidateAvailability.length;
    const interviewerDays = interviewerAvailability.length;

    // Format availability details for display
    const formatAvailabilityDetails = (availability: any[], userTimezone?: string) => {
      console.log(`[formatAvailabilityDetails] Called with userTimezone:`, userTimezone);
      return availability.map(avail => {
        const timeSlots = Array.isArray(avail.time_slots) ? avail.time_slots : [];
        const formattedSlots = timeSlots.map((slot: any) => {
          // Convert UTC time slots back to user's timezone for display
          if (slot.start && slot.start.includes('T')) {
            const displayTimezone = userTimezone || scheduler.timezone || 'UTC';
            console.log(`[formatAvailabilityDetails] Converting slot: ${slot.start} -> ${slot.end} from UTC to ${displayTimezone}`);
            const startTime = format(utcToZonedTime(slot.start, displayTimezone), 'HH:mm', { timeZone: displayTimezone });
            const endTime = format(utcToZonedTime(slot.end, displayTimezone), 'HH:mm', { timeZone: displayTimezone });
            console.log(`[formatAvailabilityDetails] Converted to: ${startTime} -> ${endTime}`);
            return `${startTime}-${endTime}`;
          }
          return `${slot.start}-${slot.end}`;
        }).join(', ');
        
        console.log(`[formatAvailabilityDetails] Date: ${avail.date}, TimeSlots: ${formattedSlots}`);
        return {
          date: avail.date,
          timeSlots: formattedSlots,
          slotCount: timeSlots.length
        };
      });
    };

    res.json({
      success: true,
      scheduler: {
        id: scheduler.id,
        title: scheduler.title,
        status: scheduler.status,
        timezone: scheduler.timezone
      },
      readiness: {
        isReady,
        candidate: {
          registered: !!candidate,
          name: candidate?.name || null,
          email: candidate?.email || null,
          availabilityDays: candidateDays,
          hasAvailability: candidateAvailability.length > 0,
          availabilityDetails: formatAvailabilityDetails(candidateAvailability, candidateTimezone)
        },
        interviewers: {
          registered: interviewers.length > 0,
          count: interviewers.length,
          expected: scheduler.interviewer_count || 1,
          users: interviewers.map((interviewer: any) => {
            const interviewerLatestAvailability = getMostRecentAvailabilitySubmission(availability.filter((a: any) => a.user_id === interviewer.id));
            return {
              name: interviewer.name,
              email: interviewer.email,
              hasAvailability: interviewerLatestAvailability.length > 0,
              availabilityDays: interviewerLatestAvailability.length,
              availabilityDetails: formatAvailabilityDetails(interviewerLatestAvailability, interviewerLatestAvailability[0]?.timezone || scheduler.timezone || 'UTC')
            };
          }),
          availabilityDays: interviewerDays,
          hasAvailability: interviewerAvailability.length > 0,
          availabilityDetails: formatAvailabilityDetails(interviewerAvailability, interviewerAvailability[0]?.timezone || scheduler.timezone || 'UTC')
        },
        statistics: {
          totalUsers: users.length,
          totalAvailabilitySlots: totalSlots,
          candidateDays,
          interviewerDays
        }
      },
      missingRequirements: [
        ...(!candidate ? ['Candidate not registered'] : []),
        ...(interviewers.length === 0 ? ['No interviewers registered'] : []),
        ...(candidate && candidateAvailability.length === 0 ? ['Candidate has no availability'] : []),
        ...(interviewers.length > 0 && interviewerAvailability.length === 0 ? ['Interviewers have no availability'] : [])
      ]
    });

  } catch (error) {
    console.error('Error checking scheduler status:', error);
    res.status(500).json({ error: 'Failed to check scheduler status' });
  }
});

export default router;
