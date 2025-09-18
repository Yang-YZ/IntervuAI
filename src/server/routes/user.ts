import express, { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { body, param, validationResult } from 'express-validator';

const router = express.Router();

// Register a user (candidate or interviewer)
router.post('/register', [
  body('scheduler_id').notEmpty().withMessage('Scheduler ID is required'),
  body('name').notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('role').isIn(['candidate', 'interviewer']).withMessage('Role must be candidate or interviewer')
], async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { scheduler_id, name, email, role } = req.body;

    // Get scheduler by ID
    const scheduler = req.database.getSchedulerById(scheduler_id);
    if (!scheduler) {
      res.status(404).json({ error: 'Scheduler not found' });
      return;
    }

    // Check if user already exists for this scheduler
    const existingUser = req.database.getUserByEmailAndScheduler(email, scheduler.id);
    if (existingUser) {
      // Return success and the existing user so the client can proceed to update availability
      const availability = req.database.getAvailabilityByUserId(existingUser.id);
      res.json({
        success: true,
        existed: true,
        user: {
          id: existingUser.id,
          name: existingUser.name,
          email: existingUser.email,
          role: existingUser.role,
          scheduler_id: existingUser.scheduler_id
        },
        availability
      });
      return;
    }

    // Check if role is already taken (only for candidate, allow multiple interviewers)
    const users = req.database.getUsersBySchedulerId(scheduler.id);
    if (role === 'candidate') {
      const candidateExists = users.some(u => u.role === 'candidate');
      if (candidateExists) {
        res.status(409).json({ 
          error: 'candidate is already registered for this scheduler' 
        });
        return;
      }
    }
    // For interviewers, we allow multiple registrations

    // Create user
    const userId = uuidv4();
    const user = req.database.createUser({
      id: userId,
      scheduler_id: scheduler.id,
      name,
      email,
      role
    });

    res.status(201).json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        scheduler_id: user.scheduler_id
      }
    });
  } catch (error) {
    console.error('Error registering user:', error);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

// Get user by email and scheduler
router.get('/:scheduler_id/:email', [
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

    // Get user's availability
    const availability = req.database.getAvailabilityByUserId(user.id);

    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        scheduler_id: user.scheduler_id
      },
      availability
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Get all users for a scheduler
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

    // Get scheduler by UUID
    const scheduler = req.database.getSchedulerById(uuid);
    if (!scheduler) {
      res.status(404).json({ error: 'Scheduler not found' });
      return;
    }

    // Get users
    const users = req.database.getUsersBySchedulerId(scheduler.id);

    res.json({
      success: true,
      users: users.map(user => ({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        scheduler_id: user.scheduler_id
      }))
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

export default router;
