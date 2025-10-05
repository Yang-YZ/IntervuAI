// Attach event listeners after DOM loads
document.addEventListener('DOMContentLoaded', function() {
    // Disable register button until a scheduler is loaded or created
    const registerBtn = document.getElementById('registerUserBtn');
    if (registerBtn) registerBtn.disabled = true;

    const createBtn = document.getElementById('createSchedulerBtn');
    if (createBtn) createBtn.addEventListener('click', createScheduler);

    const loadBtn = document.getElementById('loadSchedulerBtn');
    if (loadBtn) loadBtn.addEventListener('click', loadScheduler);

    if (registerBtn) registerBtn.addEventListener('click', registerUser);


    const saveAvailBtn = document.getElementById('saveAvailabilityBtn');
    if (saveAvailBtn) saveAvailBtn.addEventListener('click', saveAvailability);

    // Generate schedule button is now dynamically created in the status display

    const refreshBtn = document.getElementById('refreshSchedulerBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', refreshScheduler);

    // Timezone selector
    const timezoneSelect = document.getElementById('timezoneSelect');
    if (timezoneSelect) timezoneSelect.addEventListener('change', changeTimezone);

    // Add date button
    const addDateBtn = document.getElementById('addDateBtn');
    if (addDateBtn) addDateBtn.addEventListener('click', addSelectedDate);

    // Pick date button (shown after registration instead of full calendar)
    const pickDateBtn = document.getElementById('pickDateBtn');
    if (pickDateBtn) pickDateBtn.addEventListener('click', () => {
        // show the availability section so user can pick a date
        showElement('calendarSection');
        hideElement('pickDateArea');
    });
});
// Global state
let currentScheduler = null;
let currentUser = null;
let currentAvailability = [];
let currentTimezone = 'UTC';

// Auto-detect user's timezone
function detectUserTimezone() {
  try {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    console.log('🌍 Auto-detected timezone:', detected);
    return detected;
  } catch (error) {
    console.log('⚠️ Could not detect timezone, using UTC');
    return 'UTC';
  }
}

// API base URL
const API_BASE = '/api';

// Utility functions
function showMessage(message, type = 'info', duration = 5000) {
    const statusDiv = document.getElementById('statusMessage');
    if (!statusDiv) {
        console.log('statusMessage div not found!');
        return;
    }
    statusDiv.innerHTML = `<div class="status-message ${type}">${message}</div>`;
    if (duration > 0) {
    setTimeout(() => {
            // Only clear if the message is unchanged (avoid clearing a newer message)
            if (statusDiv.innerHTML.includes(message)) {
        statusDiv.innerHTML = '';
            }
        }, duration);
    }
}

function clearMessage() {
    const statusDiv = document.getElementById('statusMessage');
    if (statusDiv) statusDiv.innerHTML = '';
}

function showLoading(message = 'Loading...') {
    const statusDiv = document.getElementById('statusMessage');
    statusDiv.innerHTML = `<div class="loading">${message}</div>`;
}

function hideElement(id) {
    document.getElementById(id).classList.add('hidden');
}

function showElement(id) {
    document.getElementById(id).classList.remove('hidden');
}

// Date utilities
function formatDate(date) {
    return date.toISOString().split('T')[0];
}

function getCurrentMonthDates() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - firstDay.getDay());
    
    const dates = [];
    const currentDate = new Date(startDate);
    
    for (let i = 0; i < 42; i++) {
        dates.push(new Date(currentDate));
        currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return dates;
}

// Calendar rendering
function renderCalendar() {
    const calendarDiv = document.getElementById('calendar');
    const dates = getCurrentMonthDates();
    const today = new Date();
    
    console.log('[renderCalendar] Starting render with currentAvailability:', currentAvailability);
    console.log('[renderCalendar] Current user role:', currentUser ? currentUser.role : 'no user');
    
    let html = '<div class="calendar-grid">';
    
    // Day headers
    const dayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    dayHeaders.forEach(day => {
        html += `<div class="calendar-day" style="background: #f8f9fa; font-weight: bold;">${day}</div>`;
    });
    
    // Calendar days
    dates.forEach(date => {
        const dateStr = formatDate(date);
        const isCurrentMonth = date.getMonth() === today.getMonth();
        const isToday = dateStr === formatDate(today);
        const hasAvailability = currentAvailability.some(avail => avail.date === dateStr);
        
        let classes = 'calendar-day';
        if (!isCurrentMonth) classes += ' other-month';
        if (isToday) classes += ' today';
        if (hasAvailability) classes += ' has-availability';
        
        // Get time slots for this date
        const dayAvailability = currentAvailability.find(avail => avail.date === dateStr);
        console.log(`[renderCalendar] Checking date ${dateStr}:`, dayAvailability);
        
        let timeSlotsHtml = '';
        if (dayAvailability && dayAvailability.time_slots) {
            console.log(`[renderCalendar] Found availability for ${dateStr}, time_slots:`, dayAvailability.time_slots);
            
            // Handle both array and single object formats
            let timeSlots = dayAvailability.time_slots;
            if (!Array.isArray(timeSlots)) {
                // Convert single object to array
                if (timeSlots && typeof timeSlots === 'object' && ('start' in timeSlots || 'end' in timeSlots)) {
                    timeSlots = [timeSlots];
                    console.log(`[renderCalendar] Converted single time_slots object to array:`, timeSlots);
                } else {
                    timeSlots = [];
                }
            }
            
            if (timeSlots.length > 0) {
                timeSlotsHtml = '<div class="calendar-time-slots">';
                timeSlots.forEach((slot, index) => {
                    console.log(`[renderCalendar] Processing slot ${index}:`, slot);
                    if (slot.start && slot.end) {
                        // Format time for display
                        const formatTime = (timeStr) => {
                            if (!timeStr) return '';
                            
                            // If ISO-like, convert from UTC to user's timezone
                            if (timeStr.includes('T') || timeStr.endsWith('Z')) {
                                try {
                                    const dt = new Date(timeStr);
                                    return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: currentTimezone });
                                } catch (e) {
                                    return timeStr;
                                }
                            }
                            
                            // For simple time strings (HH:MM), we need to treat them as being in the scheduler's timezone
                            // and convert to the user's selected timezone
                            if (timeStr.match(/^\d{2}:\d{2}$/)) {
                                try {
                                    // Get the scheduler's timezone (default to UTC if not set)
                                    const schedulerTimezone = currentScheduler.timezone || 'UTC';
                                    
                                    // If the scheduler timezone is the same as current timezone, no conversion needed
                                    if (schedulerTimezone === currentTimezone) {
                                        return timeStr;
                                    }
                                    
                                    // Simple approach: use a static offset map for September (DST in effect)
                                    const timezoneOffsets = {
                                        'UTC': 0,
                                        'America/New_York': -4, // EDT (summer)
                                        'America/Chicago': -5,  // CDT
                                        'America/Denver': -6,   // MDT
                                        'America/Los_Angeles': -7, // PDT (summer)
                                        'Europe/London': 1,     // BST (summer)
                                        'Europe/Paris': 2,      // CEST (summer)
                                        'Asia/Tokyo': 9,
                                        'Asia/Shanghai': 8,
                                        'Australia/Sydney': 10  // AEST (winter)
                                    };
                                    
                                    const [hours, minutes] = timeStr.split(':').map(Number);
                                    const schedulerOffset = timezoneOffsets[schedulerTimezone] || 0;
                                    const currentOffset = timezoneOffsets[currentTimezone] || 0;
                                    
                                    // Calculate the time difference
                                    const offsetDiff = currentOffset - schedulerOffset;
                                    
                                    // Apply the offset
                                    let newHours = hours + offsetDiff;
                                    let newMinutes = minutes;
                                    
                                    // Handle day overflow/underflow
                                    if (newHours < 0) {
                                        newHours += 24;
                                    } else if (newHours >= 24) {
                                        newHours -= 24;
                                    }
                                    
                                    const result = `${String(newHours).padStart(2, '0')}:${String(newMinutes).padStart(2, '0')}`;
                                    
                                    console.log(`[formatTime] Converting ${timeStr} from ${schedulerTimezone} (${schedulerOffset}) to ${currentTimezone} (${currentOffset}): ${result} (offset diff: ${offsetDiff}h)`);
                                    return result;
                                } catch (e) {
                                    console.error('[formatTime] Error converting time:', e);
                                    return timeStr;
                                }
                            }
                            
                            return timeStr;
                        };
                        const timeDisplay = `${formatTime(slot.start)}-${formatTime(slot.end)}`;
                        console.log(`[renderCalendar] Adding time slot: ${timeDisplay}`);
                        timeSlotsHtml += `<div class="calendar-time-slot">${timeDisplay}</div>`;
                    }
                });
                timeSlotsHtml += '</div>';
            }
        }
        
        html += `<div class="${classes}" data-date="${dateStr}">
            <div class="calendar-date">${date.getDate()}</div>
            ${timeSlotsHtml}
        </div>`;
    });
    
    html += '</div>';
    calendarDiv.innerHTML = html;

    // Attach click listeners to calendar days (CSP-compliant)
    const dayElements = calendarDiv.querySelectorAll('.calendar-day[data-date]');
    dayElements.forEach(el => {
        const d = el.getAttribute('data-date');
        el.addEventListener('click', () => selectDate(d));
    });
}

// API functions
async function createScheduler() {
    console.log('createScheduler function called');
    const title = document.getElementById('schedulerTitle').value;
    const description = document.getElementById('schedulerDescription').value;
    const interviewDuration = parseInt(document.getElementById('interviewDuration').value);
    const interviewerCount = parseInt(document.getElementById('interviewerCount').value);
    
    console.log('Title:', title, 'Description:', description, 'Duration:', interviewDuration, 'Interviewers:', interviewerCount);
    
    if (!title.trim()) {
        showMessage('Please enter a title for the scheduler', 'error');
        return;
    }
    
    showLoading('Creating scheduler...');
    
    try {
        console.log('Making API call to:', `${API_BASE}/scheduler/create`);
        const response = await fetch(`${API_BASE}/scheduler/create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                title: title.trim(),
                description: description.trim(),
                timezone: currentTimezone,
                interview_duration: interviewDuration,
                interviewer_count: interviewerCount
            })
        });
        
        const data = await response.json();
        console.log('[createScheduler] API response:', data);
        if (data.success && data.scheduler) {
            currentScheduler = data.scheduler;
            console.log('[createScheduler] currentScheduler set to:', currentScheduler);
            // Enable register button now that scheduler exists
            const registerBtn = document.getElementById('registerUserBtn');
            if (registerBtn) registerBtn.disabled = false;
            showMessage(`✅ Scheduler created! Your code is: ${currentScheduler.id} - Please save this ID to retrieve your scheduler later!`, 'success', 10000);
            loadSchedulerInterface();
        } else {
            showMessage('Failed to create scheduler', 'error');
        }
    } catch (error) {
        console.error('Error creating scheduler:', error);
        showMessage('Failed to create scheduler', 'error');
    }
}

async function loadScheduler() {
    const id = document.getElementById('schedulerUuid').value.trim();
    
    if (!id) {
        showMessage('Please enter a scheduler code', 'error');
        return;
    }
    
    showLoading('Loading scheduler...');
    
    try {
        const response = await fetch(`${API_BASE}/scheduler/${id}?tz=${encodeURIComponent(currentTimezone)}`);
        
        if (response.status === 404) {
            alert(`Scheduler with ID "${id}" not found. Please check the scheduler ID and try again.`);
            document.getElementById('schedulerUuid').value = '';
            return;
        }
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            currentScheduler = data.scheduler;
            currentAvailability = Array.isArray(data.scheduler.availability) ? data.scheduler.availability : [];
            currentAvailability = currentAvailability.map(av => ({
                date: av.date,
                time_slots: Array.isArray(av.time_slots) ? av.time_slots : []
            }));
            currentTimezone = data.scheduler.timezone || 'UTC';

            // Set timezone selector to user's timezone
            const timezoneSelect = document.getElementById('timezoneSelect');
            if (timezoneSelect) {
                timezoneSelect.value = currentTimezone;
            }

            // Enable register button now that scheduler is loaded
            const registerBtn = document.getElementById('registerUserBtn');
            if (registerBtn) registerBtn.disabled = false;

            showMessage('Scheduler loaded successfully', 'success');
            loadSchedulerInterface();
        } else {
            showMessage(data.error || 'Failed to load scheduler', 'error', 7000);
            const input = document.getElementById('schedulerUuid');
            if (input) input.classList.add('input-error');
        }
    } catch (error) {
        console.error('Error loading scheduler:', error);
        showMessage('Failed to load scheduler. Please check your connection and try again.', 'error', 7000);
        const input = document.getElementById('schedulerUuid');
        if (input) input.classList.add('input-error');
    }
}

// Handle a missing scheduler (404) gracefully
function handleSchedulerNotFound(id) {
    showMessage(`Scheduler with ID "${id}" not found. You can create a new one below.`, 'error', 0);
    // Reset state
    currentScheduler = null;
    currentAvailability = [];
    // Clear UI sections that rely on a scheduler
    // Calendar div removed - no longer needed
    const availabilityListDiv = document.getElementById('availabilityList');
    if (availabilityListDiv) availabilityListDiv.innerHTML = '<p style="color: var(--text-secondary); font-style: italic;">No scheduler loaded.</p>';
    // Input styling / reset
    const input = document.getElementById('schedulerUuid');
    if (input) {
        input.value = '';
        input.classList.add('input-error');
        if (!input.dataset._styled) {
            input.style.border = '2px solid #dc3545';
            input.style.outline = 'none';
            input.dataset._styled = '1';
        }
    }
    // Disable actions that require a scheduler
    const registerBtn = document.getElementById('registerUserBtn');
    if (registerBtn) registerBtn.disabled = true;
    // Show access forms again
    showElement('accessForm');
    showElement('createForm');
    const schedulerInterface = document.getElementById('schedulerInterface');
    if (schedulerInterface) schedulerInterface.classList.add('hidden');
}

function loadSchedulerInterface() {
    hideElement('accessForm');
    hideElement('createForm');
    showElement('schedulerInterface');
    
    document.getElementById('schedulerTitleDisplay').textContent = currentScheduler.title;
    
    // Always display scheduler ID next to the title
    document.getElementById('schedulerIdValue').textContent = currentScheduler.id;
    
    // Set timezone selector to scheduler's default timezone
    const timezoneSelect = document.getElementById('timezoneSelect');
    if (timezoneSelect && currentScheduler && currentScheduler.timezone) {
        timezoneSelect.value = currentScheduler.timezone;
        currentTimezone = currentScheduler.timezone;
        console.log('[loadSchedulerInterface] Setting timezone to scheduler default:', currentScheduler.timezone);
    } else {
        console.log('[loadSchedulerInterface] Using default timezone UTC');
        currentTimezone = 'UTC';
    }
    
    // If scheduler is already scheduled, show the results instead of registration
    if (currentScheduler.status === 'scheduled' && currentScheduler.scheduled_time) {
        showScheduledResults();
        return;
    }
    
    // Check if user is already registered
    checkUserRegistration();
    // Ensure register button is enabled now that a scheduler is active
    const registerBtn = document.getElementById('registerUserBtn');
    if (registerBtn) registerBtn.disabled = false;
    // Calendar rendering removed - no longer needed since calendar display is removed
    // renderCalendar();
    updateAvailabilityDisplay();
}

function showScheduledResults() {
    // Hide registration and availability forms
    hideElement('userRegistration');
    hideElement('availabilityForm');
    hideElement('calendarSection');
    
    // Show scheduled results
    const scheduledTimeDiv = document.createElement('div');
    scheduledTimeDiv.className = 'scheduled-results';
    scheduledTimeDiv.style.cssText = `
        background: var(--bg-card);
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 20px;
        margin: 20px 0;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    `;
    
    const scheduledDate = new Date(currentScheduler.scheduled_time);
    const schedulerTimezone = currentScheduler.timezone || 'UTC';
    
    const formattedDate = scheduledDate.toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric',
        timeZone: schedulerTimezone
    });
    const formattedTime = scheduledDate.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        timeZoneName: 'short',
        timeZone: schedulerTimezone
    });
    
    // Also show in user's local timezone if different
    let localTimeDisplay = '';
    if (schedulerTimezone !== currentTimezone) {
        const localFormattedTime = scheduledDate.toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit',
            timeZoneName: 'short',
            timeZone: currentTimezone
        });
        localTimeDisplay = `<br><small style="color: var(--muted);">Your local time: ${localFormattedTime}</small>`;
    }
    
    scheduledTimeDiv.innerHTML = `
        <div style="text-align: center;">
            <h3 style="color: var(--success); margin-bottom: 10px;">🎉 Interview Scheduled!</h3>
            <p style="font-size: 1.1rem; margin-bottom: 5px;"><strong>${formattedDate}</strong></p>
            <p style="font-size: 1rem; color: var(--text-secondary);">${formattedTime}${localTimeDisplay}</p>
            <p style="margin-top: 15px; color: var(--text-secondary);">Check your email for detailed information.</p>
        </div>
    `;
    
    // Insert at the top of the container
    const container = document.querySelector('.container');
    container.insertBefore(scheduledTimeDiv, container.firstChild);
}

async function checkUserRegistration() {
    const email = document.getElementById('userEmail').value;
    
    if (!email) {
        showElement('userRegistration');
        return;
    }
    
    try {
        console.log('[client] checkUserRegistration - fetching user for', email, 'scheduler', currentScheduler && currentScheduler.id);
        const response = await fetch(`${API_BASE}/user/${currentScheduler.id}/${email}`);
        const data = await response.json();
        console.log('[client] checkUserRegistration - user response:', data);
        
        if (data.success) {
            currentUser = data.user;
            document.getElementById('userName').value = currentUser.name;
            document.getElementById('userRole').value = currentUser.role;
            
            // Timezone will be set when user submits availability

            // Normalize this user's availability first
            const userAvailability = Array.isArray(data.availability) ? data.availability : [];
            const normalizedUserAvailability = userAvailability.map(av => ({
                date: av.date,
                time_slots: Array.isArray(av.time_slots) ? av.time_slots : []
            }));

            hideElement('userRegistration');

            // If the current user is an interviewer, show candidate availability instead
            if (currentUser && currentUser.role === 'interviewer') {
                try {
                    const resp = await fetch(`${API_BASE}/scheduler/${currentScheduler.id}?tz=${encodeURIComponent(currentTimezone)}`);
                    const sched = await resp.json();
                    console.log('[client] fetched scheduler for interviewer:', sched);
                    if (sched && sched.success) {
                        const users = Array.isArray(sched.scheduler.users) ? sched.scheduler.users : [];
                        let availabilityAll = Array.isArray(sched.scheduler.availability) ? sched.scheduler.availability : [];
                        // Fallback: if the scheduler response didn't include availability, call availability endpoint
                        if (!Array.isArray(availabilityAll) || availabilityAll.length === 0) {
                            try {
                                console.log('[client] scheduler response missing availability, fetching /api/availability/scheduler');
                                const aresp = await fetch(`${API_BASE}/availability/scheduler/${currentScheduler.id}?tz=${encodeURIComponent(currentTimezone)}`);
                                const ajson = await aresp.json();
                                console.log('[client] fallback availability response:', ajson);
                                if (ajson && ajson.success && Array.isArray(ajson.availability)) {
                                    availabilityAll = ajson.availability;
                                }
                            } catch (e) {
                                console.error('[client] fallback availability fetch failed', e);
                            }
                        }

                        const candidate = users.find(u => u.role === 'candidate');
                        if (candidate) {
                            console.log('[client] Found candidate:', candidate);
                            console.log('[client] Raw availabilityAll:', availabilityAll);
                            
                            // Filter availability entries for the candidate and normalize time_slots
                            const candidateAvail = availabilityAll
                                .filter(a => {
                                    const matches = a.user_id === candidate.id || a.user_email === candidate.email;
                                    console.log(`[client] Checking availability entry:`, a, 'matches candidate:', matches);
                                    return matches;
                                })
                                .map(a => {
                                    console.log(`[client] Processing availability entry:`, a);
                                    const normalized = { 
                                        date: a.date, 
                                        time_slots: Array.isArray(a.time_slots) ? a.time_slots : (a.time_slots ? [a.time_slots] : [])
                                    };
                                    console.log(`[client] Normalized entry:`, normalized);
                                    return normalized;
                                });
                            console.log('[client] candidate availability found:', candidateAvail.length, candidateAvail);
                            currentAvailability = candidateAvail;
                        } else {
                            console.log('[client] No candidate found in users:', users);
                            currentAvailability = [];
                        }
                    } else {
                        currentAvailability = [];
                    }
                } catch (e) {
                    console.error('Error loading scheduler availability for interviewer', e);
                    currentAvailability = [];
                }

                // Show full calendar for interviewers
                showElement('calendarSection');
                hideElement('pickDateArea');
            } else {
                // For non-interviewers show their own availability and the calendar
                currentAvailability = normalizedUserAvailability;
                showElement('calendarSection');
                hideElement('pickDateArea');
            }

            updateAvailabilityDisplay();
        } else {
            showElement('userRegistration');
        }
    } catch (error) {
        console.error('Error checking user registration:', error);
        showElement('userRegistration');
    }
}

async function registerUser() {
    // Debug logs for scheduler state
    console.log('currentScheduler:', currentScheduler);
    console.log('currentScheduler.id:', currentScheduler && currentScheduler.id);
    const name = document.getElementById('userName').value.trim();
    const email = document.getElementById('userEmail').value.trim();
    const role = document.getElementById('userRole').value;

    if (!name || !email || !role) {
        showMessage('Please fill in all required fields', 'error');
        return;
    }

    // Simple client-side email validation to give a friendly reminder
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        showMessage('Please enter a valid email address', 'error');
        return;
    }

    try {
        const requestBody = {
            scheduler_id: currentScheduler && currentScheduler.id,
            name,
            email,
            role
        };
        console.log('[registerUser] Request body:', requestBody);
        const response = await fetch(`${API_BASE}/user/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });
        const data = await response.json();
        console.log('[registerUser] Response:', data);

            // If server created the user (success) or returned existed user, proceed
            if (data.success) {
                // If data.user exists, use it. Otherwise, keep currentUser.
                if (data.user) currentUser = data.user;
                hideElement('userRegistration');

                // If the server returned availability (existing user), use it
                const normalizedUserAvailability = (Array.isArray(data.availability) ? data.availability : []).map(av => ({
                    date: av.date,
                    time_slots: Array.isArray(av.time_slots) ? av.time_slots : []
                }));

                if (data.existed) {
                    currentAvailability = normalizedUserAvailability;
                }

                if (currentUser && currentUser.role === 'interviewer') {
                    // If interviewer, load candidate availability and show pick CTA
                    try {
                        const resp = await fetch(`${API_BASE}/scheduler/${currentScheduler.id}?tz=${encodeURIComponent(currentTimezone)}`);
                        const sched = await resp.json();
                        let availabilityAll = Array.isArray(sched.scheduler && sched.scheduler.availability) ? sched.scheduler.availability : [];
                        if (!Array.isArray(availabilityAll) || availabilityAll.length === 0) {
                            const aresp = await fetch(`${API_BASE}/availability/scheduler/${currentScheduler.id}`);
                            const ajson = await aresp.json();
                            if (ajson && ajson.success && Array.isArray(ajson.availability)) availabilityAll = ajson.availability;
                        }
                        const users = Array.isArray(sched.scheduler && sched.scheduler.users) ? sched.scheduler.users : [];
                        const candidate = users.find(u => u.role === 'candidate');
                        console.log('[registerUser] Found candidate:', candidate);
                        console.log('[registerUser] Raw availabilityAll:', availabilityAll);
                        
                        if (candidate) {
                            currentAvailability = availabilityAll
                                .filter(a => {
                                    const matches = a.user_id === candidate.id || a.user_email === candidate.email;
                                    console.log(`[registerUser] Checking availability entry:`, a, 'matches candidate:', matches);
                                    return matches;
                                })
                                .map(a => {
                                    console.log(`[registerUser] Processing availability entry:`, a);
                                    const normalized = { 
                                        date: a.date, 
                                        time_slots: Array.isArray(a.time_slots) ? a.time_slots : (a.time_slots ? [a.time_slots] : [])
                                    };
                                    console.log(`[registerUser] Normalized entry:`, normalized);
                                    return normalized;
                                });
                            console.log('[registerUser] Final currentAvailability:', currentAvailability);
                        } else {
                            console.log('[registerUser] No candidate found in users:', users);
                            currentAvailability = [];
                        }
                    } catch (e) {
                        console.error('Error loading scheduler availability for interviewer after 409', e);
                        currentAvailability = [];
                    }

                    // Show full calendar for interviewer to view candidate availability
                    showElement('calendarSection');
                    hideElement('pickDateArea');
                    // Show availability form for interviewers to add their availability
                    showElement('availabilityForm');
                } else {
                    // Normal user: show their own availability and calendar
                    currentAvailability = normalizedUserAvailability;
                    // Show calendar for candidate so they can pick dates/times
                    showElement('calendarSection');
                    hideElement('pickDateArea');
                    // Show availability form for candidates to add their availability
                    showElement('availabilityForm');
                }

                // Show scheduling status
                await displaySchedulingStatus();
                // Friendly message if this was an existing user
                if (data.existed) {
                    showMessage('You are already registered for this scheduler — signed in.', 'info');
                }
            } else {
            // If server returned validation errors, display them as a friendly reminder
            if (data.errors && Array.isArray(data.errors)) {
                const msgs = data.errors.map(e => e.msg || (e.param ? `${e.param} invalid` : 'Invalid input'));
                showMessage(msgs.join('; '), 'error');
            } else {
                showMessage(data.error || 'Failed to register user', 'error');
            }
        }
    } catch (error) {
        console.error('Error registering user:', error);
        showMessage('Failed to register user', 'error');
    }
}

function selectDate(dateStr) {
    if (!currentUser) {
        showMessage('Please register first', 'error');
        return;
    }
    
    // Initialize selected dates display
    updateSelectedDatesDisplay();
    showElement('availabilityForm');
}



function removeTimeSlot(button) {
    button.parentElement.remove();
}

// Check scheduling readiness status
async function checkSchedulingStatus() {
    if (!currentScheduler || !currentScheduler.id) {
        return null;
    }
    
    try {
        const response = await fetch(`${API_BASE}/scheduler/${currentScheduler.id}/status`);
        const result = await response.json();
        
        if (result.success) {
            return result.readiness;
        }
    } catch (error) {
        console.error('Error checking scheduling status:', error);
    }
    
    return null;
}

// Display scheduling status to user
async function displaySchedulingStatus() {
    const status = await checkSchedulingStatus();
    if (!status) return;
    
    const statusDiv = document.getElementById('schedulingStatus');
    if (!statusDiv) return;
    
    let statusHTML = '<h3>📋 Scheduling Status</h3>';
    
    // Candidate status with availability details
    const candidate = status.candidate || {};
    statusHTML += `
        <div class="status-item">
            <strong>Candidate:</strong> 
            ${candidate.registered ? 
                `✅ ${candidate.name || 'Unknown'} (${candidate.email || 'No email'})` : 
                '❌ Not registered'
            }
            ${candidate.hasAvailability ? 
                ` - ${candidate.availabilityDays || 0} day(s) available` : 
                ' - No availability provided'
            }
            ${candidate.availabilityDetails && Array.isArray(candidate.availabilityDetails) && candidate.availabilityDetails.length > 0 ? 
                `<div class="availability-details">
                    ${candidate.availabilityDetails.map(detail => 
                        `<div class="availability-day">
                            <strong>${new Date(detail.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}:</strong> 
                            ${detail.timeSlots} (${detail.slotCount} slot${detail.slotCount !== 1 ? 's' : ''})
                        </div>`
                    ).join('')}
                </div>` : ''
            }
        </div>
    `;
    
    // Interviewers status with individual availability details
    const interviewers = status.interviewers || {};
    statusHTML += `
        <div class="status-item">
            <strong>Interviewer${interviewers.count !== 1 ? 's' : ''}:</strong> 
            ${interviewers.registered ? 
                `✅ ${interviewers.count || 0} of ${interviewers.expected || 1} interviewer${interviewers.expected !== 1 ? 's' : ''} registered` : 
                '❌ No interviewers registered'
            }
        </div>
    `;
    
    // Show each interviewer individually with their availability
    if (interviewers.users && Array.isArray(interviewers.users) && interviewers.users.length > 0) {
        interviewers.users.forEach(interviewer => {
            statusHTML += `
                <div class="status-item">
                    <strong>Interviewer:</strong> 
                    ${interviewer.name} (${interviewer.email}) ${interviewer.hasAvailability ? '✅' : '❌'}
                    ${interviewer.hasAvailability ? 
                        ` - ${interviewer.availabilityDays || 0} day(s) available` : 
                        ' - No availability provided'
                    }
                    ${interviewer.availabilityDetails && Array.isArray(interviewer.availabilityDetails) && interviewer.availabilityDetails.length > 0 ? 
                        `<div class="availability-details">
                            ${interviewer.availabilityDetails.map(detail => 
                                `<div class="availability-day">
                                    <strong>${new Date(detail.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}:</strong> 
                                    ${detail.timeSlots} (${detail.slotCount} slot${detail.slotCount !== 1 ? 's' : ''})
                                </div>`
                            ).join('')}
                        </div>` : ''
                    }
                </div>
            `;
        });
    }
    
    // Overall status
    if (status.isReady) {
        statusHTML += `
            <div class="status-ready">
                🎉 <strong>Ready to schedule!</strong> Both parties have provided availability.
            </div>
            <div style="text-align: center; margin-top: 15px;">
                <button class="btn" id="generateScheduleBtnMain" style="background: var(--primary-600); font-size: 16px; padding: 12px 24px;">
                    🚀 Generate Schedule
                </button>
            </div>
        `;
    } else {
        statusHTML += `
            <div class="status-waiting">
                ⏳ <strong>Waiting for:</strong>
                <ul>
                    ${(status.missingRequirements || []).map(req => `<li>${req}</li>`).join('')}
                </ul>
            </div>
        `;
    }
    
    statusDiv.innerHTML = statusHTML;
    statusDiv.style.display = 'block';
    
    // Add event listener for the main generate schedule button
    const generateBtn = document.getElementById('generateScheduleBtnMain');
    if (generateBtn) {
        // Remove any existing event listeners to avoid duplicates
        generateBtn.replaceWith(generateBtn.cloneNode(true));
        const newGenerateBtn = document.getElementById('generateScheduleBtnMain');
        if (newGenerateBtn) {
            newGenerateBtn.addEventListener('click', function(e) {
                console.log('Generate schedule button clicked');
                e.preventDefault();
                generateSchedule();
            });
        }
    }
}

// Check if both users have availability and trigger scheduling

// Manual schedule generation function
async function generateSchedule() {
    
    if (!currentScheduler || !currentScheduler.id) {
        showMessage('No scheduler loaded', 'error');
        return;
    }
    
    try {
        showMessage('Generating schedule...', 'info');
        
        const response = await fetch(`${API_BASE}/scheduler/${currentScheduler.id}/generate-schedule`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        const result = await response.json();
        
        if (result.success) {
            if (result.schedule.success) {
                // Schedule found!
                showMessage('🎉 Interview scheduled successfully! Check your email for details.', 'success');
                
                // Update scheduler status
                currentScheduler.status = 'scheduled';
                currentScheduler.scheduled_time = result.schedule.scheduled_time;
                
                // Show detailed schedule information
                showDetailedSchedule(result.schedule);
                
                // Hide availability forms
                hideElement('availabilityForm');
                hideElement('calendarSection');
                
            } else {
                // No suitable time found
                showMessage(`No suitable time found: ${result.schedule.message}`, 'warning');
                
                // Still show the detailed schedule even if no time was found
                showDetailedSchedule(result.schedule);
                
                // Show suggested times if available
                if (result.schedule.suggested_times && result.schedule.suggested_times.length > 0) {
                    showSuggestedTimes(result.schedule.suggested_times);
                }
            }
        } else {
            showMessage('Failed to generate schedule. Please try again.', 'error');
        }
    } catch (error) {
        console.error('Error generating schedule:', error);
        showMessage('Failed to generate schedule. Please try again.', 'error');
    }
}

// Show suggested times when no exact match is found
function showSuggestedTimes(suggestedTimes) {
    const suggestionsDiv = document.createElement('div');
    suggestionsDiv.className = 'card';
    suggestionsDiv.innerHTML = `
        <h3>💡 Suggested Times</h3>
        <p>No exact match found, but here are some suggested times:</p>
        <ul>
            ${suggestedTimes.map(time => {
                const date = new Date(time);
                const formattedDate = date.toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });
                const formattedTime = date.toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                    timeZoneName: 'short'
                });
                return `<li><strong>${formattedDate}</strong> at ${formattedTime}</li>`;
            }).join('')}
        </ul>
        <p style="color: var(--muted); font-size: 0.9rem;">
            Please provide more availability to find a better match.
        </p>
    `;
    
    // Insert after the header
    const container = document.querySelector('.container');
    const header = document.querySelector('.header');
    container.insertBefore(suggestionsDiv, header.nextSibling);
}

// Show the scheduled time to the user
// Show detailed schedule information
async function showDetailedSchedule(scheduleData) {
    // Use the scheduler's timezone for display
    const schedulerTimezone = currentScheduler.timezone || 'UTC';
    
    const scheduledDate = new Date(scheduleData.scheduled_time);
    const formattedDate = scheduledDate.toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric',
        timeZone: schedulerTimezone
    });
    const formattedTime = scheduledDate.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        timeZoneName: 'short',
        timeZone: schedulerTimezone
    });

    const scheduledTimeDiv = document.createElement('div');
    scheduledTimeDiv.className = 'card';
    
    let html = `
        <h2>✅ Interview Scheduled Successfully!</h2>
        <div class="scheduled-info" style="text-align: center; padding: 20px;">
            <h3 style="color: var(--primary); margin-bottom: 10px;">${formattedDate}</h3>
            <p style="font-size: 1.2rem; color: var(--text-dark);">${formattedTime}</p>
            <p style="color: var(--muted); margin-top: 10px;">${scheduleData.message || 'Confirmation emails have been sent to all participants.'}</p>
            <p style="color: var(--muted); font-size: 0.9rem; margin-top: 10px;">
                📍 All times shown in ${schedulerTimezone} timezone
            </p>
        </div>
    `;

    // Only show Individual Interview Sessions - no other sections needed

    // Show individual interviews if available
    if (scheduleData.individual_interviews && scheduleData.individual_interviews.length > 0) {
        html += `
            <div class="individual-interviews" style="margin-top: 20px;">
                <h4 style="color: var(--text-dark); margin-bottom: 15px;">👥 Individual Interview Sessions</h4>
                <div class="interviews-table" style="overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">
                        <thead>
                            <tr style="background: var(--primary-100);">
                                <th style="padding: 8px; border: 1px solid var(--border); text-align: left;">Time</th>
                                <th style="padding: 8px; border: 1px solid var(--border); text-align: left;">Interviewer</th>
                            </tr>
                        </thead>
                        <tbody>
        `;

        scheduleData.individual_interviews.forEach((interview) => {
            // Convert interview time to scheduler's timezone
            const interviewDateTime = new Date(`${interview.date}T${interview.start_time}:00Z`);
            const date = interviewDateTime.toLocaleDateString('en-US', { 
                weekday: 'short', 
                month: 'short', 
                day: 'numeric',
                timeZone: schedulerTimezone
            });
            const startTime = interviewDateTime.toLocaleTimeString('en-US', { 
                hour: '2-digit', 
                minute: '2-digit',
                timeZone: schedulerTimezone
            });
            const endDateTime = new Date(`${interview.date}T${interview.end_time}:00Z`);
            const endTime = endDateTime.toLocaleTimeString('en-US', { 
                hour: '2-digit', 
                minute: '2-digit',
                timeZone: schedulerTimezone
            });
            const time = `${date} ${startTime} - ${endTime}`;
            
            html += `
                <tr>
                    <td style="padding: 8px; border: 1px solid var(--border);">${time}</td>
                    <td style="padding: 8px; border: 1px solid var(--border);">${interview.interviewer_name}</td>
                </tr>
            `;
        });

        html += `
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    // Only show Individual Interview Sessions - no other sections needed

    scheduledTimeDiv.innerHTML = html;
    
    // Insert at the top of the container
    const container = document.querySelector('.container');
    container.insertBefore(scheduledTimeDiv, container.firstChild);
    
}


async function saveAvailability() {
    if (selectedDates.length === 0) {
        showMessage('Please select at least one date', 'error');
        return;
    }
    
    // Collect time slots for each date
    const availability = [];
    
    selectedDates.forEach((dateObj) => {
        const date = typeof dateObj === 'string' ? dateObj : dateObj.date;
        const timeSlots = typeof dateObj === 'object' && dateObj.timeSlots ? dateObj.timeSlots : [];
        
        if (timeSlots.length > 0) {
            availability.push({
                date,
                time_slots: timeSlots
            });
        }
    });
    
    if (availability.length === 0) {
        showMessage('Please add at least one time slot for any selected date', 'error');
        return;
    }
    
    console.log(`[saveAvailability] Final availability object:`, availability);
    showLoading('Saving availability...');
    
    try {
        
        const response = await fetch(`${API_BASE}/availability/save`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                scheduler_id: currentScheduler.id,
                user_email: currentUser.email,
                timezone: currentTimezone,
                availability
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showMessage('Availability saved successfully', 'success');
            // Don't hide the availability form - let users add more availability if needed
            // hideElement('availabilityForm');
            
            // Clear selected dates so users can add more availability
            selectedDates = [];
            updateSelectedDatesDisplay();
            
            // Refresh availability
            await loadUserAvailability();
            // renderCalendar(); // Calendar display removed
            
            // Show scheduling status (includes availability details)
            await displaySchedulingStatus();
            
        } else {
            showMessage(data.error || 'Failed to save availability', 'error');
        }
    } catch (error) {
        console.error('Error saving availability:', error);
        showMessage('Failed to save availability', 'error');
    }
}

async function loadUserAvailability() {
    if (!currentUser) return;
    
    try {
    const response = await fetch(`${API_BASE}/availability/user/${currentScheduler.id}/${currentUser.email}?tz=${encodeURIComponent(currentTimezone)}`);
        const data = await response.json();
        
        if (data.success) {
            currentAvailability = data.availability || [];
        }
    } catch (error) {
        console.error('Error loading availability:', error);
    }
}

function updateAvailabilityDisplay() {
    const availabilityListDiv = document.getElementById('availabilityList');
    const availabilityHeader = document.querySelector('#currentAvailability h3');
    
    if (currentAvailability.length === 0) {
        availabilityListDiv.innerHTML = '<p>No availability set yet.</p>';
        hideElement('currentAvailability');
        return;
    }
    
    showElement('currentAvailability');
    // Update header to reflect whose availability is shown
    if (availabilityHeader) {
        if (currentUser && currentUser.role === 'interviewer') {
            availabilityHeader.textContent = "Candidate's Availability";
        } else {
            availabilityHeader.textContent = 'Your Current Availability';
        }
    }
    
    let html = '';
    // Helper to render YYYY-MM-DD as a local date string (avoid timezone shifts)
    const renderLocalDate = (ymd) => {
        if (!ymd || typeof ymd !== 'string') return ymd;
        const parts = ymd.split('-').map(p => parseInt(p, 10));
        if (parts.length < 3 || parts.some(isNaN)) return ymd;
        const d = new Date(parts[0], parts[1] - 1, parts[2]);
        return d.toLocaleDateString();
    };

    currentAvailability.forEach(avail => {
        const date = renderLocalDate(avail.date);
        html += `<div><strong>${date}:</strong> `;
        // time_slots may be an array or a single object; normalize to an array
        let slots = avail.time_slots;
        if (!Array.isArray(slots)) {
            if (slots && typeof slots === 'object' && ('start' in slots || 'end' in slots)) {
                slots = [slots];
            } else {
                slots = [];
            }
        }
        // convert ISO UTC slot strings to user's timezone display (HH:mm) when needed
        const formatSlotForDisplay = (rawStart, rawEnd) => {
            const toDisplay = (s) => {
                if (!s) return '';
                // if ISO-like, convert from UTC to user's timezone
                if (s.includes('T') || s.endsWith('Z')) {
                    try {
                        const dt = new Date(s);
                        return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: currentTimezone });
                    } catch (e) {
                        return s;
                    }
                }
                
                // For simple time strings (HH:MM), apply timezone conversion
                if (s.match(/^\d{2}:\d{2}$/)) {
                    try {
                        // Get the scheduler's timezone (default to UTC if not set)
                        const schedulerTimezone = currentScheduler.timezone || 'UTC';
                        
                        // If the scheduler timezone is the same as current timezone, no conversion needed
                        if (schedulerTimezone === currentTimezone) {
                            return s;
                        }
                        
                        // Use more accurate timezone conversion with date-fns-tz
                        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
                        const dateTimeString = `${today}T${s}:00`;
                        
                        // Create a date in the scheduler's timezone
                        const zonedTime = new Date(dateTimeString + (schedulerTimezone === 'UTC' ? 'Z' : ''));
                        
                        // Convert to user's timezone
                        const convertedTime = zonedTime.toLocaleTimeString('en-US', {
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: false,
                            timeZone: currentTimezone
                        });
                        
                        console.log(`[formatSlotForDisplay] Converting ${s} from ${schedulerTimezone} to ${currentTimezone}: ${convertedTime}`);
                        return convertedTime;
                    } catch (e) {
                        console.error('[formatSlotForDisplay] Error converting time:', e);
                        return s;
                    }
                }
                
                return s;
            };
            return `${toDisplay(rawStart)} - ${toDisplay(rawEnd)}`;
        };

        slots.forEach(slot => {
            const start = slot && slot.start ? slot.start : '';
            const end = slot && slot.end ? slot.end : '';
            html += `<span class="time-slot">${formatSlotForDisplay(start, end)}</span>`;
        });
        html += '</div>';
    });
    
    availabilityListDiv.innerHTML = html;
}

// Duplicate function removed - using the main generateSchedule function above

function showScheduledInfo(scheduledTime) {
    const scheduledInfoDiv = document.getElementById('scheduledInfo');
    const scheduledTimeDiv = document.getElementById('scheduledTime');
    
    const formattedTime = new Date(scheduledTime).toLocaleString('en-US', {
        timeZone: currentTimezone,
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short'
    });
    
    scheduledTimeDiv.textContent = `Scheduled for: ${formattedTime}`;
    showElement('scheduledInfo');
    hideElement('scheduleActions');
}

// Global variable to store selected dates
let selectedDates = [];

// Quick time slot templates removed - users can manually add time slots

function addSelectedDate() {
    const dateInput = document.getElementById('selectedDate');
    const selectedDate = dateInput.value;
    
    if (!selectedDate) {
        showMessage('Please select a date first', 'error');
        return;
    }
    
    // Check if date already exists
    const existingDate = selectedDates.find(d => (typeof d === 'string' ? d : d.date) === selectedDate);
    if (existingDate) {
        showMessage('This date is already selected', 'error');
        return;
    }
    
    // Add to selected dates with empty time slots
    selectedDates.push({
        date: selectedDate,
        timeSlots: []
    });
    
    // Update the display
    updateSelectedDatesDisplay();
    
    // Clear the input
    dateInput.value = '';
    
    showMessage(`Added ${selectedDate} to your availability`, 'success');
}

function updateSelectedDatesDisplay() {
    const selectedDatesList = document.getElementById('selectedDatesList');
    
    selectedDatesList.innerHTML = '';
    
    if (selectedDates.length === 0) {
        selectedDatesList.innerHTML = '<p style="color: var(--text-secondary); font-style: italic;">No dates selected</p>';
        return;
    }
    
    selectedDates.forEach((dateObj, index) => {
        const date = typeof dateObj === 'string' ? dateObj : dateObj.date;
        const timeSlots = typeof dateObj === 'object' && dateObj.timeSlots ? dateObj.timeSlots : [];
        
        const dateDiv = document.createElement('div');
        dateDiv.className = 'selected-date-item';
        
        const formattedDate = new Date(date + 'T00:00:00').toLocaleDateString('en-US', { 
            weekday: 'short', 
            month: 'short', 
            day: 'numeric' 
        });
        
        let timeSlotsHtml = '';
        timeSlots.forEach((slot, slotIndex) => {
            timeSlotsHtml += `
                <div class="time-slot-item">
                    <input type="time" value="${slot.start}" data-date-index="${index}" data-slot-index="${slotIndex}" data-field="start" class="time-input" />
                    <span>to</span>
                    <input type="time" value="${slot.end}" data-date-index="${index}" data-slot-index="${slotIndex}" data-field="end" class="time-input" />
                    <button type="button" class="remove-time-btn" data-date-index="${index}" data-slot-index="${slotIndex}">Remove</button>
                </div>
            `;
        });
        
        dateDiv.innerHTML = `
            <div class="selected-date-header">
                <div class="selected-date-title">${formattedDate}</div>
                <button type="button" class="remove-date-btn" data-date-index="${index}">Remove Date</button>
            </div>
            <div class="time-slots-container">
                ${timeSlotsHtml}
                <button type="button" class="add-time-btn" data-date-index="${index}">Add Time Slot</button>
            </div>
        `;
        
        selectedDatesList.appendChild(dateDiv);
    });
    
    // Add event listeners for all the buttons and inputs
    addEventListenersToAvailabilityForm();
}

function saveCurrentTimeValues() {
    const timeValues = {};
    selectedDates.forEach((date, dateIndex) => {
        const timeSlotsContainer = document.getElementById(`timeSlots_${dateIndex}`);
        if (timeSlotsContainer) {
            const timeRanges = timeSlotsContainer.querySelectorAll('.time-range');
            timeValues[dateIndex] = [];
            timeRanges.forEach((timeRange, timeIndex) => {
                const startTime = timeRange.querySelector('input[type="time"]').value;
                const endTime = timeRange.querySelectorAll('input[type="time"]')[1].value;
                timeValues[dateIndex].push({ startTime, endTime });
            });
        }
    });
    return timeValues;
}

function restoreTimeValues(timeValues) {
    Object.keys(timeValues).forEach(dateIndex => {
        const timeSlotsContainer = document.getElementById(`timeSlots_${dateIndex}`);
        if (timeSlotsContainer) {
            const timeRanges = timeSlotsContainer.querySelectorAll('.time-range');
            timeValues[dateIndex].forEach((timeValue, timeIndex) => {
                if (timeRanges[timeIndex]) {
                    const startInput = timeRanges[timeIndex].querySelector('input[type="time"]');
                    const endInput = timeRanges[timeIndex].querySelectorAll('input[type="time"]')[1];
                    if (startInput) startInput.value = timeValue.startTime;
                    if (endInput) endInput.value = timeValue.endTime;
                }
            });
        }
    });
}

function addEventListenersToDateButtons() {
    // Add event listeners for remove date buttons
    document.querySelectorAll('.remove-date-btn').forEach(button => {
        button.addEventListener('click', function() {
            const dateIndex = parseInt(this.getAttribute('data-date-index'));
            removeSelectedDate(dateIndex);
        });
    });
    
    // Add event listeners for add time buttons
    document.querySelectorAll('.add-time-btn').forEach(button => {
        button.addEventListener('click', function() {
            const dateIndex = parseInt(this.getAttribute('data-date-index'));
            addTimeSlotForDate(dateIndex);
        });
    });
    
    // Add event listeners for remove time buttons
    document.querySelectorAll('.remove-time-btn').forEach(button => {
        button.addEventListener('click', function() {
            removeTimeSlot(this);
        });
    });
}

function removeSelectedDate(index) {
    selectedDates.splice(index, 1);
    updateSelectedDatesDisplay();
}

function addTimeSlotForDate(dateIndex) {
    if (!selectedDates[dateIndex].timeSlots) {
        selectedDates[dateIndex].timeSlots = [];
    }
    
    selectedDates[dateIndex].timeSlots.push({
        start: '09:00',
        end: '17:00'
    });
    
    updateSelectedDatesDisplay();
}

function removeTimeSlot(dateIndex, slotIndex) {
    selectedDates[dateIndex].timeSlots.splice(slotIndex, 1);
    updateSelectedDatesDisplay();
}

function updateTimeSlot(dateIndex, slotIndex, field, value) {
    selectedDates[dateIndex].timeSlots[slotIndex][field] = value;
}

function addEventListenersToAvailabilityForm() {
    // Add event listeners for time inputs
    const timeInputs = document.querySelectorAll('.time-input');
    timeInputs.forEach(input => {
        input.addEventListener('change', function() {
            const dateIndex = parseInt(this.dataset.dateIndex);
            const slotIndex = parseInt(this.dataset.slotIndex);
            const field = this.dataset.field;
            const value = this.value;
            updateTimeSlot(dateIndex, slotIndex, field, value);
        });
    });
    
    // Add event listeners for remove time buttons
    const removeTimeBtns = document.querySelectorAll('.remove-time-btn');
    removeTimeBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const dateIndex = parseInt(this.dataset.dateIndex);
            const slotIndex = parseInt(this.dataset.slotIndex);
            removeTimeSlot(dateIndex, slotIndex);
        });
    });
    
    // Add event listeners for remove date buttons
    const removeDateBtns = document.querySelectorAll('.remove-date-btn');
    removeDateBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const dateIndex = parseInt(this.dataset.dateIndex);
            removeSelectedDate(dateIndex);
        });
    });
    
    // Add event listeners for add time slot buttons
    const addTimeBtns = document.querySelectorAll('.add-time-btn');
    addTimeBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            const dateIndex = parseInt(this.dataset.dateIndex);
            addTimeSlotForDate(dateIndex);
        });
    });
}

// Old functions removed - using new simplified approach

function convertTimeToUTC(timeStr, timezone) {
    const timezoneOffsets = {
        'UTC': 0,
        'America/New_York': -4, // EDT (summer)
        'America/Chicago': -5,  // CDT
        'America/Denver': -6,   // MDT
        'America/Los_Angeles': -7, // PDT (summer)
        'Europe/London': 1,     // BST (summer)
        'Europe/Paris': 2,      // CEST (summer)
        'Asia/Tokyo': 9,
        'Asia/Shanghai': 8,
        'Australia/Sydney': 10  // AEST (winter)
    };
    
    const [hours, minutes] = timeStr.split(':').map(Number);
    const offset = timezoneOffsets[timezone] || 0;
    
    // Convert to UTC by subtracting the offset
    let utcHours = hours - offset;
    let utcMinutes = minutes;
    
    // Handle day overflow/underflow
    if (utcHours >= 24) {
        utcHours -= 24;
    } else if (utcHours < 0) {
        utcHours += 24;
    }
    
    return `${utcHours.toString().padStart(2, '0')}:${utcMinutes.toString().padStart(2, '0')}`;
}

function changeTimezone() {
    currentTimezone = document.getElementById('timezoneSelect').value;
    console.log('[changeTimezone] Timezone changed to:', currentTimezone);
    if (currentScheduler) {
        console.log('[changeTimezone] Timezone changed, updating availability display');
        // renderCalendar(); // Calendar display removed
        updateAvailabilityDisplay();
    }
}

function refreshScheduler() {
    if (currentScheduler) {
        loadScheduler();
    }
}

// Initialize the app
document.addEventListener('DOMContentLoaded', function() {
    // Set default date to today when the selectedDate element exists
    const selectedDateElement = document.getElementById('selectedDate');
    if (selectedDateElement) {
        selectedDateElement.value = formatDate(new Date());
    }
    
    // Auto-detect and set timezone
    const detectedTimezone = detectUserTimezone();
    currentTimezone = detectedTimezone;
    
    // Set timezone selector to detected timezone
    const timezoneSelects = document.querySelectorAll('#timezoneSelect');
    timezoneSelects.forEach(select => {
        select.value = detectedTimezone;
    });
    
    console.log('🌍 Initialized with timezone:', detectedTimezone);
});
