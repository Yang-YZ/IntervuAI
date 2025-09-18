import express, { Request, Response } from 'express';
import { zonedTimeToUtc, utcToZonedTime, format } from 'date-fns-tz';
import { v4 as uuidv4 } from 'uuid';
import { body, param, validationResult } from 'express-validator';

const router = express.Router();

// Save user availability
router.post('/save', [
  body('scheduler_id').isUUID().withMessage('Invalid scheduler UUID'),
  body('user_email').isEmail().withMessage('Valid email is required'),
  body('availability').isArray().withMessage('Availability must be an array'),
  body('availability.*.date').isISO8601().withMessage('Date must be in ISO format (YYYY-MM-DD)'),
  body('availability.*.time_slots').isArray().withMessage('Time slots must be an array'),
  body('availability.*.time_slots.*.start').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Start time must be in HH:MM format'),
  body('availability.*.time_slots.*.end').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('End time must be in HH:MM format')
], async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

  const { scheduler_id, user_email, availability, timezone } = req.body;
  console.log(`[availability/save] Received request:`, { scheduler_id, user_email, timezone, availability });

    // Get scheduler by UUID
    const scheduler = req.database.getSchedulerById(scheduler_id);
    if (!scheduler) {
      res.status(404).json({ error: 'Scheduler not found' });
      return;
    }

    // Get user
    const user = req.database.getUserByEmailAndScheduler(user_email, scheduler.id);
    if (!user) {
      res.status(404).json({ error: 'User not found. Please register first.' });
      return;
    }

    // Save availability as one submission (replaces any existing availability for this user)
    const availabilityId = uuidv4();
    const tz = timezone || scheduler.timezone || 'UTC';
    console.log(`[availability/save] Converting availability for user ${user.email}, timezone: ${tz}`);
    
    const timeSlots: any[] = [];
    availability.forEach((avail: any) => {
      const normalizedSlots = (Array.isArray(avail.time_slots) ? avail.time_slots : [avail.time_slots]).map((slot: any) => {
        // Store local times directly, no UTC conversion needed
        console.log(`[availability/save] Storing local time: ${slot.start} -> ${slot.end} for date ${avail.date} in timezone ${tz}`);
        return { 
          date: avail.date,
          start: slot.start, 
          end: slot.end
        };
      });
      timeSlots.push(...normalizedSlots);
    });

    
    const saved = req.database.saveAvailability({
      id: availabilityId,
      user_id: user.id,
      scheduler_id: scheduler.id,
      time_slots: timeSlots,
      timezone: tz
    });

    res.json({
      success: true,
      message: 'Availability saved successfully',
      availability: saved
    });
  } catch (error) {
    console.error('Error saving availability:', error);
    res.status(500).json({ error: 'Failed to save availability' });
  }
});

// Get availability for a scheduler
router.get('/scheduler/:uuid', [
  param('uuid').isUUID().withMessage('Invalid UUID format')
], async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

  const { uuid } = req.params;
  const tz = (req.query.tz as string) || 'UTC';

    // Get scheduler by UUID
    const scheduler = req.database.getSchedulerById(uuid);
    if (!scheduler) {
      res.status(404).json({ error: 'Scheduler not found' });
      return;
    }

    // Get availability (stored in UTC)
    let availability = req.database.getAvailabilityBySchedulerId(scheduler.id);
    // If timezone requested, convert stored UTC ISO slots to local HH:MM strings
    if (tz) {
      availability = availability.map((a: any) => {
        const slots = Array.isArray(a.time_slots) ? a.time_slots : [];
        const converted = slots.map((slot: any) => {
          const startLocal = format(utcToZonedTime(slot.start, tz), 'HH:mm', { timeZone: tz });
          const endLocal = format(utcToZonedTime(slot.end, tz), 'HH:mm', { timeZone: tz });
          return { start: startLocal, end: endLocal };
        });
        return { ...a, time_slots: converted };
      });
    }

    res.json({ success: true, availability });
  } catch (error) {
    console.error('Error fetching availability:', error);
    res.status(500).json({ error: 'Failed to fetch availability' });
  }
});

// Get availability for a specific user
router.get('/user/:scheduler_id/:email', [
  param('scheduler_id').isUUID().withMessage('Invalid scheduler UUID'),
  param('email').isEmail().withMessage('Valid email is required')
], async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

  const { scheduler_id, email } = req.params;
  const tz = (req.query.tz as string) || 'UTC';

    // Get scheduler by UUID
    const scheduler = req.database.getSchedulerById(scheduler_id);
    if (!scheduler) {
      res.status(404).json({ error: 'Scheduler not found' });
      return;
    }

    // Get user
    const user = req.database.getUserByEmailAndScheduler(email, scheduler.id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Get user's availability (stored in UTC)
    let availability = req.database.getAvailabilityByUserId(user.id);
    if (tz) {
      availability = availability.map((a: any) => {
        const slots = Array.isArray(a.time_slots) ? a.time_slots : [];
        const converted = slots.map((slot: any) => {
          const startLocal = format(utcToZonedTime(slot.start, tz), 'HH:mm', { timeZone: tz });
          const endLocal = format(utcToZonedTime(slot.end, tz), 'HH:mm', { timeZone: tz });
          return { start: startLocal, end: endLocal };
        });
        return { ...a, time_slots: converted };
      });
    }

    res.json({ success: true, availability });
  } catch (error) {
    console.error('Error fetching user availability:', error);
    res.status(500).json({ error: 'Failed to fetch user availability' });
  }
});

// Clear availability for a user
router.delete('/user/:scheduler_id/:email', [
  param('scheduler_id').isUUID().withMessage('Invalid scheduler UUID'),
  param('email').isEmail().withMessage('Valid email is required')
], async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { scheduler_id, email } = req.params;

    // Get scheduler by UUID
    const scheduler = req.database.getSchedulerById(scheduler_id);
    if (!scheduler) {
      res.status(404).json({ error: 'Scheduler not found' });
      return;
    }

    // Get user
    const user = req.database.getUserByEmailAndScheduler(email, scheduler.id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Clear user's availability
    req.database.clearAvailabilityByUserId(user.id);

    res.json({
      success: true,
      message: 'Availability cleared successfully'
    });
  } catch (error) {
    console.error('Error clearing availability:', error);
    res.status(500).json({ error: 'Failed to clear availability' });
  }
});

export default router;
