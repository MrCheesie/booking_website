/**
 * Space Booking System
 * Direct NocoDB Integration with IST slot auto-expiration logic
 */

// --- CONFIGURATION & ENDPOINTS ---
// When deployed on Vercel, requests route securely through the serverless proxy /api/bookings.
// For standalone local testing without Vercel CLI, it can fall back to local direct values.
const API_ENDPOINT = '/api/bookings';

// Fallback configuration for direct local testing without Vercel backend
const LOCAL_FALLBACK_CONFIG = {
  API_BASE_URL: 'https://app.nocodb.com/api/v3/data/pkz8in31iu7ry08/mdercpqw2jaff7c/records',
  VIEW_ID: 'vw0zglw7zbwdq9db',
  API_TOKEN: 'nc_pat_F6v55L659Ju2aGW646SUXxlV4Ovu1EJWSATo5qhS'
};

// All available spaces specified in INSTRUCTIONS.md
const SPACES = [
  'Auditorium part 1',
  'Auditorium part 2',
  'Auditorium part 3',
  'A.V. Room',
  'Library',
  'Physics Lab',
  'Chemistry lab',
  'I.T. Lab',
  'TCTE lab',
  'Sports Ground'
];

// Rotating dynamic words from the wireframe top note
const WORDS = ['Session', 'Class', 'Workshop', 'Practice', 'Break', 'Assessment'];

// Slot time ranges in Indian Standard Time (IST, UTC+5:30)
// Slot 1: 08:45 - 10:45
// Slot 2: 11:15 - 13:15
// Slot 3: 14:00 - 16:30
const SLOT_DEFINITIONS = {
  1: { label: 'Period 1 (8:45 - 10:45)', startHour: 8, startMin: 45, endHour: 10, endMin: 45 },
  2: { label: 'Period 2 (11:15 - 1:15)', startHour: 11, startMin: 15, endHour: 13, endMin: 15 },
  3: { label: 'Period 3 (2:00 - 4:30)', startHour: 14, startMin: 0, endHour: 16, endMin: 30 }
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// --- APPLICATION STATE ---
let currentDay = 'Monday';
let currentSlot = 1;
let cachedBookings = [];
let wordIndex = 0;
let selectedSpaceToBook = '';

// --- DOM ELEMENTS ---
const daySelect = document.getElementById('day-select');
const slotSelect = document.getElementById('slot-select');
const refreshBtn = document.getElementById('refresh-btn');
const tableBody = document.getElementById('table-body');
const animatedWordEl = document.getElementById('animated-word');
const istClockEl = document.getElementById('ist-clock');
const apiStatusText = document.getElementById('api-status-text');
const apiStatusDot = document.querySelector('#api-status .status-dot');
const pastSlotBanner = document.getElementById('past-slot-banner');

// Modals
const bookingModal = document.getElementById('booking-modal');
const modalCloseBtn = document.getElementById('modal-close-btn');
const bookingForm = document.getElementById('booking-form');
const teacherNameInput = document.getElementById('teacher-name');
const modalSpaceInput = document.getElementById('modal-space');
const modalDaySelect = document.getElementById('modal-day');
const modalSlotSelect = document.getElementById('modal-slot');
const bookingReasonInput = document.getElementById('booking-reason');
const formErrorMsg = document.getElementById('form-error');
const submitBookingBtn = document.getElementById('submit-booking-btn');

const successModal = document.getElementById('success-modal');
const successMessageEl = document.getElementById('success-message');
const successCloseBtn = document.getElementById('success-close-btn');
const toastEl = document.getElementById('toast');

// --- IST TIME UTILITIES ---

/**
 * Returns current Date object converted to Indian Standard Time (IST)
 */
function getISTDate() {
  const now = new Date();
  // IST offset is UTC+5:30 -> +330 minutes
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  return new Date(utc + (3600000 * 5.5));
}

/**
 * Updates IST clock pill in the header
 */
function updateISTClock() {
  const ist = getISTDate();
  const options = {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  };
  istClockEl.textContent = `IST: ${ist.toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' })} | ${ist.toLocaleTimeString('en-US', options)}`;
}

/**
 * Checks if a slot on a given day has already expired relative to current IST time.
 * "Slots should free as soon as the time is over. Use Indian Standard Time."
 */
function isSlotExpired(dayName, slotNum) {
  const ist = getISTDate();
  const currentISTDayIndex = ist.getDay(); // 0 is Sunday, 1 is Monday ...
  const currentISTDayName = DAY_NAMES[currentISTDayIndex];

  const targetDayIndex = DAY_NAMES.indexOf(dayName);
  if (targetDayIndex === -1) return false;

  // Compare day index relative to current week day
  // If the target day is earlier in the week than today, it has passed
  if (targetDayIndex < currentISTDayIndex) {
    return true;
  }
  // If it's a future day in the week, it has not expired
  if (targetDayIndex > currentISTDayIndex) {
    return false;
  }

  // If target day is TODAY in IST, check end time of the slot
  const slotDef = SLOT_DEFINITIONS[slotNum];
  if (!slotDef) return false;

  const currentMinutes = ist.getHours() * 60 + ist.getMinutes();
  const slotEndMinutes = slotDef.endHour * 60 + slotDef.endMin;

  return currentMinutes >= slotEndMinutes;
}

// --- NOCODB API SERVICE ---

/**
 * Fetch all booking records (Calls /api/bookings on Vercel, with fallback for local file servers)
 */
async function fetchBookingsFromNocoDB() {
  let response;
  try {
    response = await fetch(API_ENDPOINT, { method: 'GET' });
    if (response.status === 404 && LOCAL_FALLBACK_CONFIG.API_TOKEN) {
      // Local fallback if running simple static server without Vercel backend
      const url = `${LOCAL_FALLBACK_CONFIG.API_BASE_URL}?pageSize=100&viewId=${LOCAL_FALLBACK_CONFIG.VIEW_ID}`;
      response = await fetch(url, {
        method: 'GET',
        headers: {
          'xc-token': LOCAL_FALLBACK_CONFIG.API_TOKEN,
          'Content-Type': 'application/json'
        }
      });
    }
  } catch (e) {
    if (LOCAL_FALLBACK_CONFIG.API_TOKEN) {
      const url = `${LOCAL_FALLBACK_CONFIG.API_BASE_URL}?pageSize=100&viewId=${LOCAL_FALLBACK_CONFIG.VIEW_ID}`;
      response = await fetch(url, {
        method: 'GET',
        headers: {
          'xc-token': LOCAL_FALLBACK_CONFIG.API_TOKEN,
          'Content-Type': 'application/json'
        }
      });
    } else {
      throw e;
    }
  }

  if (!response.ok) {
    throw new Error(`Data fetch error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return (data.records || []).map(r => ({
    id: r.id,
    spot: r.fields?.Spot || '',
    day: r.fields?.Day || '',
    slot: Number(r.fields?.Slot || 0),
    teacher: r.fields?.Teacher || '',
    why: r.fields?.Why || ''
  }));
}

/**
 * Create a new booking record (Calls /api/bookings on Vercel, with fallback for local file servers)
 */
async function createBookingInNocoDB(bookingData) {
  const payload = [
    {
      fields: {
        Spot: bookingData.spot,
        Day: bookingData.day,
        Slot: Number(bookingData.slot),
        Teacher: bookingData.teacher,
        Why: bookingData.why
      }
    }
  ];

  let response;
  try {
    response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (response.status === 404 && LOCAL_FALLBACK_CONFIG.API_TOKEN) {
      response = await fetch(LOCAL_FALLBACK_CONFIG.API_BASE_URL, {
        method: 'POST',
        headers: {
          'xc-token': LOCAL_FALLBACK_CONFIG.API_TOKEN,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
    }
  } catch (e) {
    if (LOCAL_FALLBACK_CONFIG.API_TOKEN) {
      response = await fetch(LOCAL_FALLBACK_CONFIG.API_BASE_URL, {
        method: 'POST',
        headers: {
          'xc-token': LOCAL_FALLBACK_CONFIG.API_TOKEN,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
    } else {
      throw e;
    }
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to save booking: ${response.status} - ${errorText}`);
  }

  return await response.json();
}

// --- UI RENDERING ---

/**
 * Renders the table rows based on current filters and active bookings
 */
function renderTable() {
  const selectedDay = daySelect.value;
  const selectedSlot = Number(slotSelect.value);
  const expired = isSlotExpired(selectedDay, selectedSlot);

  // Toggle expired banner
  if (expired) {
    pastSlotBanner.classList.remove('hidden');
  } else {
    pastSlotBanner.classList.add('hidden');
  }

  // Filter bookings for current active day and slot
  // Note: If the slot has expired in IST, it automatically frees up or is marked as expired
  const activeBookings = cachedBookings.filter(b => 
    b.day.toLowerCase() === selectedDay.toLowerCase() && 
    Number(b.slot) === selectedSlot
  );

  // Build a lookup map by spot name
  const bookingMap = new Map();
  activeBookings.forEach(b => {
    bookingMap.set(b.spot.toLowerCase().trim(), b);
  });

  tableBody.innerHTML = '';

  SPACES.forEach(spaceName => {
    const tr = document.createElement('tr');
    const existing = bookingMap.get(spaceName.toLowerCase().trim());

    // Check if slot has expired in IST
    const isPast = expired;

    // Space Name Cell
    const spaceTd = document.createElement('td');
    spaceTd.className = 'col-space';
    spaceTd.innerHTML = `<span class="space-name">${escapeHtml(spaceName)}</span>`;

    // Booked Status Cell
    const bookedTd = document.createElement('td');
    bookedTd.className = 'col-booked';

    // Why / Reason Cell
    const whyTd = document.createElement('td');
    whyTd.className = 'col-why';

    if (existing && !isPast) {
      // Space is currently booked
      bookedTd.innerHTML = `<span class="booked-teacher">${escapeHtml(existing.teacher)}</span>`;
      whyTd.innerHTML = `<span class="booked-reason">${escapeHtml(existing.why || '-')}</span>`;
    } else if (isPast) {
      // Slot has already elapsed in IST
      if (existing) {
        bookedTd.innerHTML = `<span class="status-expired">${escapeHtml(existing.teacher)} (Past)</span>`;
        whyTd.innerHTML = `<span class="status-expired">${escapeHtml(existing.why || '-')}</span>`;
      } else {
        bookedTd.innerHTML = `<span class="status-expired">Slot ended</span>`;
        whyTd.innerHTML = `<span class="empty-dash">-</span>`;
      }
    } else {
      // Available to book!
      const bookBtn = document.createElement('button');
      bookBtn.className = 'btn-book-now';
      bookBtn.textContent = 'BOOK NOW';
      bookBtn.type = 'button';
      bookBtn.addEventListener('click', () => openBookingModal(spaceName, selectedDay, selectedSlot));
      bookedTd.appendChild(bookBtn);

      whyTd.innerHTML = `<span class="empty-dash">-</span>`;
    }

    tr.appendChild(spaceTd);
    tr.appendChild(bookedTd);
    tr.appendChild(whyTd);
    tableBody.appendChild(tr);
  });
}

/**
 * Loads data from NocoDB and updates UI
 */
async function loadData() {
  refreshBtn.classList.add('spinning');
  try {
    const data = await fetchBookingsFromNocoDB();
    cachedBookings = data;
    apiStatusDot.className = 'status-dot';
    apiStatusText.textContent = 'Connected to NocoDB';
    renderTable();
  } catch (err) {
    console.error('Error fetching bookings:', err);
    apiStatusDot.className = 'status-dot error';
    apiStatusText.textContent = 'Sync Error (Offline/Invalid Token)';
    showToast('Failed to sync with NocoDB. Please check API credentials.');
    renderTable();
  } finally {
    refreshBtn.classList.remove('spinning');
  }
}

// --- MODAL & BOOKING HANDLERS ---

function openBookingModal(spaceName, day, slot) {
  selectedSpaceToBook = spaceName;
  modalSpaceInput.value = spaceName;
  modalDaySelect.value = day;
  modalSlotSelect.value = String(slot);
  teacherNameInput.value = '';
  bookingReasonInput.value = '';
  formErrorMsg.classList.add('hidden');
  formErrorMsg.textContent = '';
  bookingModal.classList.remove('hidden');
  teacherNameInput.focus();
}

function closeBookingModal() {
  bookingModal.classList.add('hidden');
}

async function handleBookingSubmit(e) {
  e.preventDefault();

  const teacherName = teacherNameInput.value.trim();
  const space = modalSpaceInput.value.trim();
  const day = modalDaySelect.value;
  const slot = Number(modalSlotSelect.value);
  const reason = bookingReasonInput.value.trim();

  if (!teacherName) {
    showFormError('Please enter your name.');
    teacherNameInput.focus();
    return;
  }

  if (!reason) {
    showFormError('Please enter a reason or purpose for booking.');
    bookingReasonInput.focus();
    return;
  }

  // Check if slot has expired in IST
  if (isSlotExpired(day, slot)) {
    showFormError('This slot has already ended in Indian Standard Time (IST). Please select an upcoming slot.');
    return;
  }

  // Disable submit button and show spinner
  submitBookingBtn.disabled = true;
  submitBookingBtn.querySelector('.btn-text').textContent = 'Booking...';
  submitBookingBtn.querySelector('.spinner').classList.remove('hidden');
  formErrorMsg.classList.add('hidden');

  try {
    const newBooking = {
      spot: space,
      day: day,
      slot: slot,
      teacher: teacherName,
      why: reason
    };

    await createBookingInNocoDB(newBooking);

    // Optimistically add to cached bookings
    cachedBookings.push(newBooking);

    closeBookingModal();
    openSuccessModal(space, day, slot);

    // Update filters to match booked slot if different
    daySelect.value = day;
    slotSelect.value = String(slot);
    renderTable();

  } catch (err) {
    console.error('Booking failed:', err);
    showFormError('Failed to submit booking to NocoDB: ' + err.message);
  } finally {
    submitBookingBtn.disabled = false;
    submitBookingBtn.querySelector('.btn-text').textContent = 'Confirm Booking';
    submitBookingBtn.querySelector('.spinner').classList.add('hidden');
  }
}

function showFormError(msg) {
  formErrorMsg.textContent = msg;
  formErrorMsg.classList.remove('hidden');
}

function openSuccessModal(space, day, slot) {
  const slotDef = SLOT_DEFINITIONS[slot];
  const slotLabel = slotDef ? slotDef.label : `Period ${slot}`;
  successMessageEl.textContent = `${space} booked for ${day} (${slotLabel})!`;
  successModal.classList.remove('hidden');
}

function closeSuccessModal() {
  successModal.classList.add('hidden');
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.remove('hidden');
  setTimeout(() => {
    toastEl.classList.add('hidden');
  }, 4000);
}

// Utility: Escape HTML to prevent injection
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// --- ANIMATION / DYNAMIC WORD SWITCHER ---
function startWordAnimation() {
  setInterval(() => {
    wordIndex = (wordIndex + 1) % WORDS.length;
    animatedWordEl.classList.remove('word-enter');
    // Trigger reflow
    void animatedWordEl.offsetWidth;
    animatedWordEl.textContent = WORDS[wordIndex];
    animatedWordEl.classList.add('word-enter');
  }, 2500);
}

// --- INITIALIZATION ---
function init() {
  // Set default day to today if Mon-Sat, else Monday
  const ist = getISTDate();
  const todayName = DAY_NAMES[ist.getDay()];
  if (todayName !== 'Sunday') {
    daySelect.value = todayName;
  } else {
    daySelect.value = 'Monday';
  }

  // Set default slot based on current IST time
  const curMinutes = ist.getHours() * 60 + ist.getMinutes();
  if (curMinutes < 10 * 60 + 45) {
    slotSelect.value = "1";
  } else if (curMinutes < 13 * 60 + 15) {
    slotSelect.value = "2";
  } else {
    slotSelect.value = "3";
  }

  // Event listeners
  daySelect.addEventListener('change', renderTable);
  slotSelect.addEventListener('change', renderTable);
  refreshBtn.addEventListener('click', loadData);

  modalCloseBtn.addEventListener('click', closeBookingModal);
  bookingForm.addEventListener('submit', handleBookingSubmit);
  successCloseBtn.addEventListener('click', closeSuccessModal);

  // Close modals when clicking background overlay
  bookingModal.addEventListener('click', (e) => {
    if (e.target === bookingModal) closeBookingModal();
  });
  successModal.addEventListener('click', (e) => {
    if (e.target === successModal) closeSuccessModal();
  });

  // IST Clock interval
  updateISTClock();
  setInterval(updateISTClock, 1000);

  // Periodic check for expired slots every 30 seconds
  setInterval(renderTable, 30000);

  // Start animated header word rotation
  startWordAnimation();

  // Initial load from NocoDB
  loadData();
}

document.addEventListener('DOMContentLoaded', init);
