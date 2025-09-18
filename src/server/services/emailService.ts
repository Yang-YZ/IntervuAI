import nodemailer from 'nodemailer';
import { EmailNotification, Availability } from '../../shared/types';

export class EmailService {
  private transporter: nodemailer.Transporter;

  constructor(config: {
    host: string;
    port: number;
    user: string;
    pass: string;
    from: string;
  }) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: {
        user: config.user,
        pass: config.pass
      }
    });
  }

  async sendEmail(notification: EmailNotification): Promise<boolean> {
    try {
      await this.transporter.sendMail({
        from: process.env.EMAIL_FROM,
        to: notification.to,
        subject: notification.subject,
        html: notification.html
      });
      return true;
    } catch (error) {
      console.error('Email sending error:', error);
      return false;
    }
  }

  generateScheduleConfirmationEmail(
    schedulerId: string,
    scheduledTime: string,
    timezone: string,
    candidateName: string,
    interviewerName: string,
    candidateEmail: string,
    interviewerEmail: string
  ): { candidate: EmailNotification; interviewer: EmailNotification } {
    const formattedTime = new Date(scheduledTime).toLocaleString('en-US', {
      timeZone: timezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short'
    });

    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
    const schedulerUrl = `${baseUrl}/scheduler/${schedulerId}`;

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Interview Scheduled</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #4CAF50; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9f9f9; }
          .schedule-info { background-color: white; padding: 15px; border-radius: 5px; margin: 15px 0; }
          .button { display: inline-block; padding: 10px 20px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 5px; margin: 10px 5px; }
          .button.reject { background-color: #f44336; }
          .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎉 Interview Scheduled!</h1>
          </div>
          <div class="content">
            <p>Great news! Your interview has been successfully scheduled.</p>
            
            <div class="schedule-info">
              <h3>📅 Interview Details</h3>
              <p><strong>Date & Time:</strong> ${formattedTime}</p>
              <p><strong>Candidate:</strong> ${candidateName}</p>
              <p><strong>Interviewer:</strong> ${interviewerName}</p>
            </div>

            <p>Please mark this time in your calendar and prepare accordingly.</p>

            <div style="text-align: center; margin: 20px 0;">
              <a href="${schedulerUrl}" class="button">View Scheduler</a>
            </div>

            <h4>Need to make changes?</h4>
            <p>If you need to reschedule or have any questions, simply reply to this email with:</p>
            <ul>
              <li><strong>ACCEPT</strong> - to confirm the schedule</li>
              <li><strong>CHANGE REQUEST</strong> - to request a different time (please suggest new availability)</li>
            </ul>
          </div>
          <div class="footer">
            <p>This email was sent by IntervuAI. If you have any questions, please reply to this email.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return {
      candidate: {
        to: candidateEmail,
        subject: `Interview Scheduled - ${formattedTime}`,
        html: emailHtml,
        scheduler_id: schedulerId
      },
      interviewer: {
        to: interviewerEmail,
        subject: `Interview Scheduled - ${formattedTime}`,
        html: emailHtml,
        scheduler_id: schedulerId
      }
    };
  }

  generateAvailabilityRequestEmail(
    schedulerId: string,
    candidateName: string,
    interviewerName: string,
    candidateAvailability: Availability[],
    interviewerAvailability: Availability[],
    timezone: string,
    candidateEmail: string,
    interviewerEmail: string,
    customMessage?: string
  ): { candidate: EmailNotification; interviewer: EmailNotification } {
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
    const schedulerUrl = `${baseUrl}/scheduler/${schedulerId}`;

    const formatAvailability = (availability: Availability[]) => {
      if (availability.length === 0) return "No availability provided";
      return availability.map(avail => {
        // Handle new schema with time_slots containing date info
        if (avail.time_slots && Array.isArray(avail.time_slots)) {
          // Group time slots by date
          const dateMap = new Map<string, string[]>();
          avail.time_slots.forEach((slot: any) => {
            if (!dateMap.has(slot.date)) {
              dateMap.set(slot.date, []);
            }
            dateMap.get(slot.date)!.push(`${slot.start}-${slot.end}`);
          });
          
          return Array.from(dateMap.entries()).map(([date, timeSlots]) => 
            `${date}: ${timeSlots.join(', ')}`
          ).join('<br>');
        }
        // Fallback for legacy format (should not happen with new schema)
        return "Availability data format not recognized";
      }).join('<br>');
    };

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Availability Update Needed</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #FF9800; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9f9f9; }
          .availability-box { background-color: white; padding: 15px; border-radius: 5px; margin: 15px 0; border-left: 4px solid #FF9800; }
          .button { display: inline-block; padding: 10px 20px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 5px; margin: 10px 0; }
          .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📅 Availability Update Needed</h1>
          </div>
          <div class="content">
            <p>Hello!</p>
            <p>We're having trouble finding a suitable time for your interview between <strong>${candidateName}</strong> and <strong>${interviewerName}</strong>.</p>
            
            ${customMessage ? `<p><em>${customMessage}</em></p>` : ''}

            <div class="availability-box">
              <h4>Current Availability:</h4>
              <p><strong>Candidate (${candidateName}):</strong><br>${formatAvailability(candidateAvailability)}</p>
              <p><strong>Interviewer (${interviewerName}):</strong><br>${formatAvailability(interviewerAvailability)}</p>
              <p><strong>Timezone:</strong> ${timezone}</p>
            </div>

            <p>Please update your availability by visiting the scheduler and adding more time slots that work for you.</p>

            <div style="text-align: center; margin: 20px 0;">
              <a href="${schedulerUrl}" class="button">Update Availability</a>
            </div>

            <p>Once both parties have updated their availability, we'll automatically find the best time for your interview.</p>
          </div>
          <div class="footer">
            <p>This email was sent by IntervuAI. If you have any questions, please reply to this email.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return {
      candidate: {
        to: candidateEmail,
        subject: `Availability Update Needed - Interview with ${interviewerName}`,
        html: emailHtml,
        scheduler_id: schedulerId
      },
      interviewer: {
        to: interviewerEmail,
        subject: `Availability Update Needed - Interview with ${candidateName}`,
        html: emailHtml,
        scheduler_id: schedulerId
      }
    };
  }
}
