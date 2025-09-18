-- Schedulers table
CREATE TABLE IF NOT EXISTS schedulers (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'waiting_for_availability',
    scheduled_time TEXT,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    interview_duration INTEGER NOT NULL DEFAULT 60, -- Duration in minutes
    interviewer_count INTEGER NOT NULL DEFAULT 1, -- Number of interviewers expected
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    scheduler_id TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('candidate', 'interviewer')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (scheduler_id) REFERENCES schedulers(id) ON DELETE CASCADE
);

-- Availability table
CREATE TABLE IF NOT EXISTS availability (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    scheduler_id TEXT NOT NULL,
    time_slots TEXT NOT NULL, -- JSON array of time slots with date-time info
    timezone TEXT NOT NULL, -- User's timezone when they submitted
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (scheduler_id) REFERENCES schedulers(id) ON DELETE CASCADE
);


-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_scheduler_id ON users(scheduler_id);
CREATE INDEX IF NOT EXISTS idx_availability_scheduler_id ON availability(scheduler_id);
CREATE INDEX IF NOT EXISTS idx_availability_user_id ON availability(user_id);
