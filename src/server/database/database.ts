import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { Scheduler, User, Availability } from '../../shared/types';

export class Database {
  private db: any;
  private dbPath: string;
  private initialized: boolean = false;

  constructor(dbPath: string = './database.sqlite') {
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    const SQL = await initSqlJs();
    
    // Load existing database or create new one
    if (existsSync(this.dbPath)) {
      const filebuffer = readFileSync(this.dbPath);
      this.db = new SQL.Database(filebuffer);
    } else {
      this.db = new SQL.Database();
    }

    // Create tables if they don't exist
    this.createTables();
    // Run migrations for existing databases
    this.migrateDatabase();
    this.initialized = true;
  }

  private createTables(): void {
    const schema = `
      -- Schedulers table
      CREATE TABLE IF NOT EXISTS schedulers (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL DEFAULT 'waiting_for_availability',
          scheduled_time TEXT,
          timezone TEXT NOT NULL DEFAULT 'UTC',
          interview_duration INTEGER NOT NULL DEFAULT 60,
          interviewer_count INTEGER NOT NULL DEFAULT 1,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      -- Users table
      CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          scheduler_id TEXT NOT NULL,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('candidate', 'interviewer')),
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (scheduler_id) REFERENCES schedulers(id) ON DELETE CASCADE
      );

      -- Availability table
      CREATE TABLE IF NOT EXISTS availability (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          scheduler_id TEXT NOT NULL,
          date TEXT NOT NULL,
          time_slots TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (scheduler_id) REFERENCES schedulers(id) ON DELETE CASCADE
      );

      -- Indexes for better performance
      CREATE INDEX IF NOT EXISTS idx_users_scheduler_id ON users(scheduler_id);
      CREATE INDEX IF NOT EXISTS idx_availability_scheduler_id ON availability(scheduler_id);
      CREATE INDEX IF NOT EXISTS idx_availability_user_id ON availability(user_id);
    `;

    this.db.exec(schema);
    this.saveDatabase();
  }

  private migrateDatabase(): void {
    try {
      // Check if uuid column exists and remove it
      const uuidResult = this.db.exec(`
        SELECT name FROM pragma_table_info('schedulers') WHERE name = 'uuid'
      `);
      
      if (uuidResult.length > 0 && uuidResult[0].values.length > 0) {
        console.log('🔄 Removing uuid column from schedulers table...');
        // SQLite doesn't support DROP COLUMN directly, so we need to recreate the table
        this.db.exec(`
          CREATE TABLE schedulers_new (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT,
            status TEXT NOT NULL DEFAULT 'waiting_for_availability',
            scheduled_time TEXT,
            timezone TEXT NOT NULL DEFAULT 'UTC',
            interview_duration INTEGER NOT NULL DEFAULT 60,
            interviewer_count INTEGER NOT NULL DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
          )
        `);
        this.db.exec('INSERT INTO schedulers_new SELECT id, title, description, status, scheduled_time, timezone, interview_duration, interviewer_count, created_at, updated_at FROM schedulers');
        this.db.exec('DROP TABLE schedulers');
        this.db.exec('ALTER TABLE schedulers_new RENAME TO schedulers');
        this.saveDatabase();
        console.log('✅ Migration completed: uuid column removed');
      }

      // Check if interview_duration column exists
      const durationResult = this.db.exec(`
        SELECT name FROM pragma_table_info('schedulers') WHERE name = 'interview_duration'
      `);
      
      if (durationResult.length === 0 || durationResult[0].values.length === 0) {
        console.log('🔄 Adding interview_duration column to schedulers table...');
        this.db.exec('ALTER TABLE schedulers ADD COLUMN interview_duration INTEGER NOT NULL DEFAULT 60');
        this.saveDatabase();
        console.log('✅ Migration completed: interview_duration column added');
      }

      // Check if interviewer_count column exists
      const countResult = this.db.exec(`
        SELECT name FROM pragma_table_info('schedulers') WHERE name = 'interviewer_count'
      `);
      
      if (countResult.length === 0 || countResult[0].values.length === 0) {
        console.log('🔄 Adding interviewer_count column to schedulers table...');
        this.db.exec('ALTER TABLE schedulers ADD COLUMN interviewer_count INTEGER NOT NULL DEFAULT 1');
        this.saveDatabase();
        console.log('✅ Migration completed: interviewer_count column added');
      }

      // Check if timezone column exists in users table and remove it
      const timezoneResult = this.db.exec(`
        SELECT name FROM pragma_table_info('users') WHERE name = 'timezone'
      `);
      
      if (timezoneResult.length > 0 && timezoneResult[0].values.length > 0) {
        console.log('🔄 Removing timezone column from users table...');
        this.db.exec(`
          CREATE TABLE users_new (
            id TEXT PRIMARY KEY,
            scheduler_id TEXT NOT NULL,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('candidate', 'interviewer')),
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (scheduler_id) REFERENCES schedulers(id) ON DELETE CASCADE
          )
        `);
        this.db.exec('INSERT INTO users_new SELECT id, scheduler_id, name, email, role, created_at, updated_at FROM users');
        this.db.exec('DROP TABLE users');
        this.db.exec('ALTER TABLE users_new RENAME TO users');
        this.saveDatabase();
        console.log('✅ Migration completed: timezone column removed from users table');
      }

      // Check if availability table needs migration to new schema
      const availabilityColumns = this.db.exec(`
        SELECT name FROM pragma_table_info('availability')
      `);
      
      if (availabilityColumns.length > 0 && availabilityColumns[0].values.length > 0) {
        const columnNames = availabilityColumns[0].values.map((row: any) => row[0]);
        
        // Check if old schema (has 'date' column) or new schema (has 'timezone' column)
        const hasDateColumn = columnNames.includes('date');
        const hasTimezoneColumn = columnNames.includes('timezone');
        
        if (hasDateColumn && !hasTimezoneColumn) {
          console.log('🔄 Migrating availability table to new schema...');
          
          // Create new availability table
          this.db.exec(`
            CREATE TABLE availability_new (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              scheduler_id TEXT NOT NULL,
              time_slots TEXT NOT NULL,
              timezone TEXT NOT NULL DEFAULT 'UTC',
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
              FOREIGN KEY (scheduler_id) REFERENCES schedulers(id) ON DELETE CASCADE
            )
          `);
          
          // Migrate existing data - group by user_id and scheduler_id to create one record per user
          const existingData = this.db.exec('SELECT * FROM availability ORDER BY user_id, scheduler_id, updated_at');
          if (existingData.length > 0 && existingData[0].values.length > 0) {
            const userAvailabilityMap = new Map();
            
            // Group availability by user_id and scheduler_id
            existingData[0].values.forEach((row: any) => {
              const [id, user_id, scheduler_id, date, time_slots, created_at, updated_at] = row;
              const key = `${user_id}_${scheduler_id}`;
              
              if (!userAvailabilityMap.has(key)) {
                userAvailabilityMap.set(key, {
                  id: id,
                  user_id: user_id,
                  scheduler_id: scheduler_id,
                  time_slots: [],
                  timezone: 'UTC', // Default timezone for migrated data
                  created_at: created_at,
                  updated_at: updated_at
                });
              }
              
              const userData = userAvailabilityMap.get(key);
              // Add date to each time slot
              const parsedTimeSlots = JSON.parse(time_slots);
              const timeSlotsWithDate = parsedTimeSlots.map((slot: any) => ({
                date: date,
                start: slot.start,
                end: slot.end
              }));
              userData.time_slots.push(...timeSlotsWithDate);
              
              // Use the latest updated_at
              if (new Date(updated_at) > new Date(userData.updated_at)) {
                userData.updated_at = updated_at;
              }
            });
            
            // Insert migrated data
            const insertStmt = this.db.prepare(`
              INSERT INTO availability_new (id, user_id, scheduler_id, time_slots, timezone, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            
            userAvailabilityMap.forEach((data) => {
              insertStmt.run([
                data.id,
                data.user_id,
                data.scheduler_id,
                JSON.stringify(data.time_slots),
                data.timezone,
                data.created_at,
                data.updated_at
              ]);
            });
            insertStmt.free();
          }
          
          // Replace old table with new one
          this.db.exec('DROP TABLE availability');
          this.db.exec('ALTER TABLE availability_new RENAME TO availability');
          this.saveDatabase();
          console.log('✅ Migration completed: availability table migrated to new schema');
        }
      }
    } catch (error) {
      console.error('Migration error:', error);
    }
  }

  private saveDatabase(): void {
    const data = this.db.export();
    const buffer = Buffer.from(data);
    writeFileSync(this.dbPath, buffer);
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
  }

  // Helper method to get single row
  private getRow(query: string, params: any[] = []): any {
    const stmt = this.db.prepare(query);
    stmt.bind(params);
    if (stmt.step()) {
      const result: any = {};
      const colNames = stmt.getColumnNames();
      const values = stmt.get();
      for (let i = 0; i < colNames.length; i++) {
        result[colNames[i]] = values[i];
      }
      stmt.free();
      return result;
    }
    stmt.free();
    return null;
  }

  // Helper method to get all rows
  private getAllRows(query: string, params: any[] = []): any[] {
    const stmt = this.db.prepare(query);
    stmt.bind(params);
    const results: any[] = [];
    while (stmt.step()) {
      const result: any = {};
      const colNames = stmt.getColumnNames();
      const values = stmt.get();
      for (let i = 0; i < colNames.length; i++) {
        result[colNames[i]] = values[i];
      }
      results.push(result);
    }
    stmt.free();
    return results;
  }

  // Scheduler methods
  createScheduler(scheduler: Omit<Scheduler, 'created_at' | 'updated_at'>): Scheduler {
    this.ensureInitialized();
    const now = new Date().toISOString();
    
    const stmt = this.db.prepare(
      `INSERT INTO schedulers (id, title, description, status, scheduled_time, timezone, interview_duration, interviewer_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    
    stmt.run([
      scheduler.id, 
      scheduler.title, 
      scheduler.description || null, 
      scheduler.status, 
      scheduler.scheduled_time || null, 
      scheduler.timezone, 
      scheduler.interview_duration || 60,
      scheduler.interviewer_count || 1,
      now, 
      now
    ]);
    stmt.free();

    this.saveDatabase();
    return { ...scheduler, created_at: now, updated_at: now };
  }

  getSchedulerById(id: string): Scheduler | null {
    this.ensureInitialized();
    const row = this.getRow('SELECT * FROM schedulers WHERE id = ?', [id]);
    
    if (!row) return null;
    
    return {
      id: row.id as string,
      title: row.title as string,
      description: row.description as string,
      status: row.status as 'waiting_for_availability' | 'scheduling' | 'scheduled' | 'completed' | 'cancelled',
      scheduled_time: row.scheduled_time as string,
      timezone: row.timezone as string,
      interview_duration: row.interview_duration as number || 60,
      interviewer_count: row.interviewer_count as number || 1,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string
    };
  }

  updateSchedulerStatus(id: string, status: string, scheduled_time?: string): void {
    this.ensureInitialized();
    const now = new Date().toISOString();
    
    const stmt = this.db.prepare(
      'UPDATE schedulers SET status = ?, scheduled_time = ?, updated_at = ? WHERE id = ?'
    );
    
    stmt.run([status, scheduled_time, now, id]);
    stmt.free();
    this.saveDatabase();
  }

  // User methods
  createUser(user: Omit<User, 'created_at' | 'updated_at'>): User {
    this.ensureInitialized();
    const now = new Date().toISOString();
    
    const stmt = this.db.prepare(
      `INSERT INTO users (id, scheduler_id, name, email, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    
    stmt.run([user.id, user.scheduler_id, user.name, user.email, user.role, now, now]);
    stmt.free();
    this.saveDatabase();

    return { ...user, created_at: now, updated_at: now };
  }

  getUsersBySchedulerId(schedulerId: string): User[] {
    this.ensureInitialized();
    const rows = this.getAllRows('SELECT * FROM users WHERE scheduler_id = ?', [schedulerId]);
    
    return rows.map((row: any) => ({
      id: row.id,
      scheduler_id: row.scheduler_id,
      name: row.name,
      email: row.email,
      role: row.role,
      timezone: row.timezone || 'UTC',
      created_at: row.created_at,
      updated_at: row.updated_at
    }));
  }

  getUserByEmailAndScheduler(email: string, schedulerId: string): User | null {
    this.ensureInitialized();
    const row = this.getRow('SELECT * FROM users WHERE email = ? AND scheduler_id = ?', [email, schedulerId]);
    
    if (!row) return null;
    
    return {
      id: row.id as string,
      scheduler_id: row.scheduler_id as string,
      name: row.name as string,
      email: row.email as string,
      role: row.role as 'candidate' | 'interviewer',
      created_at: row.created_at as string,
      updated_at: row.updated_at as string
    };
  }

  // Availability methods
  saveAvailability(availability: Omit<Availability, 'created_at' | 'updated_at'>): Availability {
    this.ensureInitialized();
    const now = new Date().toISOString();
    
    // Delete existing availability for this user (replace entire submission)
    const deleteStmt = this.db.prepare('DELETE FROM availability WHERE user_id = ? AND scheduler_id = ?');
    deleteStmt.run([availability.user_id, availability.scheduler_id]);
    deleteStmt.free();
    
    const insertStmt = this.db.prepare(
      `INSERT INTO availability (id, user_id, scheduler_id, time_slots, timezone, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    
    insertStmt.run([
      availability.id, availability.user_id, availability.scheduler_id, 
      JSON.stringify(availability.time_slots), availability.timezone, now, now
    ]);
    insertStmt.free();

    this.saveDatabase();
    return { ...availability, created_at: now, updated_at: now };
  }

  clearAvailabilityByUserId(userId: string): void {
    this.ensureInitialized();
    const stmt = this.db.prepare('DELETE FROM availability WHERE user_id = ?');
    stmt.run([userId]);
    stmt.free();
    this.saveDatabase();
  }

  getAvailabilityBySchedulerId(schedulerId: string): Availability[] {
    this.ensureInitialized();
    const rows = this.getAllRows('SELECT * FROM availability WHERE scheduler_id = ?', [schedulerId]);
    
    return rows.map((row: any) => ({
      id: row.id,
      user_id: row.user_id,
      scheduler_id: row.scheduler_id,
      time_slots: JSON.parse(row.time_slots),
      timezone: row.timezone,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));
  }

  getAvailabilityByUserId(userId: string): Availability[] {
    this.ensureInitialized();
    const rows = this.getAllRows('SELECT * FROM availability WHERE user_id = ?', [userId]);
    
    return rows.map((row: any) => ({
      id: row.id,
      user_id: row.user_id,
      scheduler_id: row.scheduler_id,
      time_slots: JSON.parse(row.time_slots),
      timezone: row.timezone,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));
  }


  close(): void {
    if (this.initialized) {
      this.saveDatabase();
      this.db.close();
    }
  }
}