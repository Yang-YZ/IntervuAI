import express, { Request, Response } from 'express';
import { body, param, validationResult } from 'express-validator';

const router = express.Router();


// Send test email (for development)
router.post('/test', [
  body('to').isEmail().withMessage('Valid email is required'),
  body('subject').notEmpty().withMessage('Subject is required'),
  body('html').notEmpty().withMessage('HTML content is required')
], async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { to, subject, html } = req.body;

    const success = await req.emailService.sendEmail({
      to,
      subject,
      html,
      scheduler_id: 'test'
    });

    if (success) {
      res.json({
        success: true,
        message: 'Test email sent successfully'
      });
    } else {
      res.status(500).json({
        error: 'Failed to send test email'
      });
    }
  } catch (error) {
    console.error('Error sending test email:', error);
    res.status(500).json({ error: 'Failed to send test email' });
  }
});

export default router;
