/**
 * EVENT MANAGER MODULE
 * Handles event CRUD, active event selection, event registrations,
 * and server synchronization for the multi-event attendance system.
 */

const EventManager = (() => {
  const EVENTS_KEY = 'smart_attendance_events';
  const ACTIVE_EVENT_KEY = 'smart_attendance_active_event';
  const REGISTRATIONS_KEY = 'smart_attendance_event_regs';

  let events = [];
  let activeEventId = null;
  let registrations = {}; // { eventId: [rollNo1, rollNo2, ...] }

  function init() {
    loadEvents();
    syncFromServer();
  }

  function loadEvents() {
    const saved = localStorage.getItem(EVENTS_KEY);
    if (saved) {
      try {
        events = JSON.parse(saved);
      } catch (e) {
        events = [];
      }
    }

    const savedRegs = localStorage.getItem(REGISTRATIONS_KEY);
    if (savedRegs) {
      try {
        registrations = JSON.parse(savedRegs);
      } catch (e) {
        registrations = {};
      }
    }

    // Restore active event
    activeEventId = localStorage.getItem(ACTIVE_EVENT_KEY) || null;

    // Validate active event still exists
    if (activeEventId && !events.find(e => e.id === activeEventId)) {
      activeEventId = null;
      localStorage.removeItem(ACTIVE_EVENT_KEY);
    }
  }

  async function syncFromServer() {
    try {
      const response = await fetch('/api/events');
      if (response.ok) {
        const data = await response.json();
        if (data.success && Array.isArray(data.events)) {
          events = data.events;
          localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
          window.dispatchEvent(new CustomEvent('events:updated'));

          // Validate active event still exists
          if (activeEventId && !events.find(e => e.id === activeEventId)) {
            activeEventId = null;
            localStorage.removeItem(ACTIVE_EVENT_KEY);
          }
        }
      }
    } catch (e) {
      // Offline fallback
    }

    // Sync registrations for active event
    if (activeEventId) {
      await syncRegistrations(activeEventId);
    }
  }

  async function syncRegistrations(eventId) {
    if (!eventId) return;
    try {
      const response = await fetch(`/api/events/registrations?eventId=${encodeURIComponent(eventId)}`);
      if (response.ok) {
        const data = await response.json();
        if (data.success && Array.isArray(data.rollNumbers)) {
          registrations[eventId] = data.rollNumbers;
          localStorage.setItem(REGISTRATIONS_KEY, JSON.stringify(registrations));
        }
      }
    } catch (e) {
      // Offline fallback
    }
  }

  // --- Getters ---
  function getEvents() {
    return [...events];
  }

  function getActiveEvent() {
    if (!activeEventId) return null;
    return events.find(e => e.id === activeEventId) || null;
  }

  function getActiveEventId() {
    return activeEventId;
  }

  function hasActiveEvent() {
    return activeEventId !== null && events.some(e => e.id === activeEventId);
  }

  function getEventById(eventId) {
    return events.find(e => e.id === eventId) || null;
  }

  // --- Active Event ---
  function setActiveEvent(eventId) {
    if (eventId === null || eventId === '' || eventId === 'none') {
      activeEventId = null;
      localStorage.removeItem(ACTIVE_EVENT_KEY);
    } else {
      activeEventId = eventId;
      localStorage.setItem(ACTIVE_EVENT_KEY, eventId);
      syncRegistrations(eventId);
    }
    window.dispatchEvent(new CustomEvent('events:switched', { detail: { eventId: activeEventId } }));
  }

  // --- CRUD ---
  async function createEvent({ name, date, description }) {
    try {
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, date, description })
      });
      const data = await res.json();
      if (data.success && data.event) {
        events.unshift(data.event);
        localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
        window.dispatchEvent(new CustomEvent('events:updated'));
        return data.event;
      }
    } catch (e) {
      console.warn('Create event error:', e);
    }
    return null;
  }

  async function updateEventDetails(eventId, updates) {
    try {
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update', eventId, updates })
      });
      const data = await res.json();
      if (data.success && data.event) {
        const idx = events.findIndex(e => e.id === eventId);
        if (idx !== -1) events[idx] = data.event;
        localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
        window.dispatchEvent(new CustomEvent('events:updated'));
        return data.event;
      }
    } catch (e) {
      console.warn('Update event error:', e);
    }
    return null;
  }

  async function deleteEventById(eventId) {
    try {
      const res = await fetch('/api/events', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId })
      });
      const data = await res.json();
      if (data.success) {
        events = events.filter(e => e.id !== eventId);
        delete registrations[eventId];
        localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
        localStorage.setItem(REGISTRATIONS_KEY, JSON.stringify(registrations));

        if (activeEventId === eventId) {
          activeEventId = null;
          localStorage.removeItem(ACTIVE_EVENT_KEY);
        }
        window.dispatchEvent(new CustomEvent('events:updated'));
        window.dispatchEvent(new CustomEvent('events:switched', { detail: { eventId: null } }));
        return true;
      }
    } catch (e) {
      console.warn('Delete event error:', e);
    }
    return false;
  }

  // --- Registrations ---
  function getRegisteredRollNumbers(eventId) {
    const eid = eventId || activeEventId;
    if (!eid) return [];
    return registrations[eid] || [];
  }

  function isStudentRegistered(rollNo, eventId) {
    const eid = eventId || activeEventId;
    if (!eid) return true; // No active event = all students are "registered" (backward compat)
    const cleanRoll = rollNo.trim().toUpperCase();
    const regs = registrations[eid] || [];
    return regs.some(r => r.trim().toUpperCase() === cleanRoll);
  }

  async function registerStudents(eventId, rollNumbers) {
    const eid = eventId || activeEventId;
    if (!eid) return { added: 0 };

    try {
      const res = await fetch('/api/events/registrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: eid, rollNumbers })
      });
      const data = await res.json();
      if (data.success) {
        // Update local cache
        if (!registrations[eid]) registrations[eid] = [];
        rollNumbers.forEach(rn => {
          const clean = rn.trim().toUpperCase();
          if (!registrations[eid].includes(clean)) {
            registrations[eid].push(clean);
          }
        });
        localStorage.setItem(REGISTRATIONS_KEY, JSON.stringify(registrations));
        return data;
      }
    } catch (e) {
      console.warn('Register students error:', e);
    }
    return { added: 0 };
  }

  async function unregisterStudent(eventId, rollNo) {
    const eid = eventId || activeEventId;
    if (!eid) return false;

    try {
      const res = await fetch('/api/events/registrations', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: eid, rollNo })
      });
      const data = await res.json();
      if (data.success) {
        const clean = rollNo.trim().toUpperCase();
        if (registrations[eid]) {
          registrations[eid] = registrations[eid].filter(r => r !== clean);
        }
        localStorage.setItem(REGISTRATIONS_KEY, JSON.stringify(registrations));
        return true;
      }
    } catch (e) {
      console.warn('Unregister student error:', e);
    }
    return false;
  }

  return {
    init,
    loadEvents,
    syncFromServer,
    getEvents,
    getActiveEvent,
    getActiveEventId,
    hasActiveEvent,
    getEventById,
    setActiveEvent,
    createEvent,
    updateEvent: updateEventDetails,
    deleteEvent: deleteEventById,
    getRegisteredRollNumbers,
    isStudentRegistered,
    registerStudents,
    unregisterStudent
  };
})();
