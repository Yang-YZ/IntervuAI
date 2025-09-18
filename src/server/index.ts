import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from 'dotenv';
import path from 'path';

// Load environment variables
config();

// Import services
import { Database } from './database/database';
import { EmailService } from './services/emailService';

// Import routes
import schedulerRoutes from './routes/scheduler';
import userRoutes from './routes/user';
import availabilityRoutes from './routes/availability';
import emailRoutes from './routes/email';

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize services
let database: Database;
const emailService = new EmailService({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT || '587'),
  user: process.env.EMAIL_USER || '',
  pass: process.env.EMAIL_PASS || '',
  from: process.env.EMAIL_FROM || 'IntervuAI <noreply@intervuai.com>'
});

// Initialize database asynchronously
async function initializeDatabase() {
  database = new Database(process.env.DATABASE_URL);
  await database.initialize();
}

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3001',
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static files (for the frontend)
app.use(express.static(path.join(__dirname, '../client')));

// Make services available to routes
app.use((req, res, next) => {
  req.database = database;
  req.emailService = emailService;
  next();
});

// API Routes
app.use('/api/scheduler', schedulerRoutes);
app.use('/api/user', userRoutes);
app.use('/api/availability', availabilityRoutes);
app.use('/api/email', emailRoutes);

// Serve the main application
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

// Catch-all handler for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

// Error handling middleware
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// Start server
async function startServer() {
  await initializeDatabase();
  
  app.listen(PORT, () => {
    console.log(`🚀 IntervuAI server running on port ${PORT}`);
    console.log(`📧 Email service: ${process.env.EMAIL_USER ? 'Configured' : 'Not configured'}`);
  });
}

startServer().catch(console.error);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down server...');
  database.close();
  process.exit(0);
});

// Extend Express Request type to include our services
declare global {
  namespace Express {
    interface Request {
      database: Database;
      emailService: EmailService;
    }
  }
}
