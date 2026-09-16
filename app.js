'use strict';

const DB_NAME = 'bookclip';
const DB_VERSION = 1;
const STORE_NAME = 'books';
const MIN_DATE = '2026-09-16';
const MIN_MONTH = new Date(2026, 8, 1);
const BOOK_COLORS = ['#C9F0E1', '#F7C6D7', '#F1D49B', '#BFD8F1', '#D9C6EA', '#F2B6A0', '#A9D9D0'];

const state = {
  books: [],
  activeBookId: null,
  editingId: null,
  returnView: 'home-view',
  calendarDate: new Date(),
  selectedDate: ''
};

if (state.calendarDate < MIN_MONTH) state.calendarDate = new Date(MIN_MONTH);

const $ = (selector) => document.querySelector(selector);
const elements = {
  views: [...document.querySelectorAll('.view')],
  navButtons: [...document.querySelectorAll('.nav-button')],
  bookshelf: $('#bookshelf'),
  bookCount: $('#book-count'),
  addBook: $('#add-book'),
  form: $('#book-form'),
  titleInput: $('#title-input'),
  reviewInput: $('#review-input'),
  canvas: $('#drawing-canvas'),
  clearDrawing: $('#clear-drawing'),
  editorTitle: $('#editor-title'),
  saveBook: $('#save-book'),
  editorBack: $('#editor-back'),
  detailBack: $('#detail-back'),
  detailTitle: $('#detail-title'),
  detailDate: $('#detail-date'),
  detailSynopsis: $('#detail-synopsis'),
  detailReview: $('#detail-review'),
  detailDrawing: $('#detail-drawing'),
  editBook: $('#edit-book'),
  calendarTitle: $('#calendar-title'),
  calendarGrid: $('#calendar-grid'),
  prevMonth: $('#prev-month'),
  nextMonth: $('#next-month'),
  dayBooks: $('#day-books'),
  toast: $('#toast')
};

let dbPromise;
let isDrawing = false;
let canvasHasInk = false;
let toastTimer;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('date', 'date', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function getAllBooks() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function putBook(book) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(book);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function refreshBooks() {
  state.books = (await getAllBooks()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  renderShelf();
  renderCalendar();
}

function showView(viewId) {
  elements.views.forEach((view) => view.classList.toggle('active', view.id === viewId));
  elements.navButtons.forEach((button) => button.classList.toggle('active', button.dataset.view === viewId));
  const isMainView = viewId === 'home-view' || viewId === 'calendar-view';
  elements.addBook.hidden = !isMainView;
  document.querySelector('.bottom-nav').hidden = !isMainView;
  $('#app').focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function hashTitle(title) {
  let hash = 0;
  for (const char of title) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return Math.abs(hash);
}

function renderShelf() {
  elements.bookCount.textContent = `${state.books.length}권`;
  elements.bookshelf.replaceChildren();
  if (!state.books.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const title = document.createElement('strong');
    title.textContent = '첫 독후감을 적어보세요';
    const copy = document.createElement('p');
    copy.textContent = '읽은 책을 기록할 때마다 이곳에 책 한 권이 차곡차곡 꽂혀요.';
    empty.append(title, copy);
    elements.bookshelf.append(empty);
    return;
  }

  for (let start = 0; start < state.books.length; start += 10) {
    const row = document.createElement('div');
    row.className = 'shelf-row';
    state.books.slice(start, start + 10).forEach((book) => {
      const hash = hashTitle(book.title);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'book-spine';
      button.style.background = BOOK_COLORS[hash % BOOK_COLORS.length];
      button.style.setProperty('--book-height', `${126 + (hash % 39)}px`);
      button.textContent = book.title;
      button.setAttribute('aria-label', `${book.title} 상세 보기`);
      button.addEventListener('click', () => openDetail(book.id, 'home-view'));
      row.append(button);
    });
    elements.bookshelf.append(row);
  }
}

function openDetail(id, fromView = 'home-view') {
  const book = state.books.find((item) => item.id === id);
  if (!book) return;
  state.activeBookId = id;
  state.returnView = fromView;
  elements.detailTitle.textContent = book.title;
  elements.detailDate.textContent = formatDate(book.date);
  elements.detailSynopsis.textContent = book.synopsis || '줄거리를 찾는 중이에요.';
  elements.detailReview.textContent = book.review || '';
  if (book.drawing) {
    elements.detailDrawing.src = book.drawing;
    elements.detailDrawing.hidden = false;
  } else {
    elements.detailDrawing.removeAttribute('src');
    elements.detailDrawing.hidden = true;
  }
  showView('detail-view');
}

function formatDate(dateString) {
  const [year, month, day] = dateString.split('-').map(Number);
  return `${year}년 ${month}월 ${day}일`;
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function resetCanvas() {
  const context = elements.canvas.getContext('2d');
  context.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, elements.canvas.width, elements.canvas.height);
  canvasHasInk = false;
}

function loadDrawing(dataUrl) {
  resetCanvas();
  if (!dataUrl) return;
  const image = new Image();
  image.onload = () => {
    elements.canvas.getContext('2d').drawImage(image, 0, 0, elements.canvas.width, elements.canvas.height);
    canvasHasInk = true;
  };
  image.src = dataUrl;
}

function openEditor(book = null) {
  state.editingId = book?.id || null;
  elements.editorTitle.textContent = book ? '독후감 고치기' : '새 독후감 쓰기';
  elements.titleInput.value = book?.title || '';
  elements.reviewInput.value = book?.review || '';
  autoGrowTextarea();
  loadDrawing(book?.drawing || '');
  showView('editor-view');
  setTimeout(() => elements.titleInput.focus(), 80);
}

function autoGrowTextarea() {
  elements.reviewInput.style.height = 'auto';
  elements.reviewInput.style.height = `${Math.max(140, elements.reviewInput.scrollHeight)}px`;
}

function getCanvasPoint(event) {
  const rect = elements.canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (elements.canvas.width / rect.width),
    y: (event.clientY - rect.top) * (elements.canvas.height / rect.height)
  };
}

function startDrawing(event) {
  event.preventDefault();
  isDrawing = true;
  canvasHasInk = true;
  elements.canvas.setPointerCapture(event.pointerId);
  const point = getCanvasPoint(event);
  const context = elements.canvas.getContext('2d');
  context.beginPath();
  context.moveTo(point.x, point.y);
}

function draw(event) {
  if (!isDrawing) return;
  event.preventDefault();
  const point = getCanvasPoint(event);
  const context = elements.canvas.getContext('2d');
  context.lineTo(point.x, point.y);
  context.strokeStyle = '#181513';
  context.lineWidth = 7;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.stroke();
}

function stopDrawing(event) {
  if (!isDrawing) return;
  isDrawing = false;
  if (elements.canvas.hasPointerCapture(event.pointerId)) elements.canvas.releasePointerCapture(event.pointerId);
}

function stripHtml(html) {
  const documentFragment = new DOMParser().parseFromString(html, 'text/html');
  return (documentFragment.body.textContent || '').replace(/\s+/g, ' ').trim();
}

async function fetchSynopsis(title) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const query = encodeURIComponent(`intitle:${title}`);
    const response = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=1&country=KR`, { signal: controller.signal });
    if (!response.ok) throw new Error('Synopsis lookup failed');
    const data = await response.json();
    const description = data.items?.[0]?.volumeInfo?.description;
    return description ? stripHtml(description) : '줄거리를 찾지 못했어요.';
  } catch (_) {
    return '줄거리를 찾지 못했어요.';
  } finally {
    clearTimeout(timer);
  }
}

async function updateSynopsis(id, title) {
  const synopsis = await fetchSynopsis(title);
  const current = (await getAllBooks()).find((book) => book.id === id);
  if (!current || current.title !== title) return;
  current.synopsis = synopsis;
  current.updatedAt = new Date().toISOString();
  await putBook(current);
  await refreshBooks();
  if (state.activeBookId === id && $('#detail-view').classList.contains('active')) {
    elements.detailSynopsis.textContent = synopsis;
  }
}

async function saveBook(event) {
  event.preventDefault();
  const title = elements.titleInput.value.trim();
  if (!title) {
    elements.titleInput.focus();
    showToast('책 제목을 적어주세요.');
    return;
  }
  elements.saveBook.disabled = true;
  try {
    const now = new Date().toISOString();
    const existing = state.editingId ? state.books.find((book) => book.id === state.editingId) : null;
    const titleChanged = Boolean(existing && existing.title !== title);
    const book = {
      id: existing?.id || (crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`),
      title,
      review: elements.reviewInput.value.trim(),
      drawing: canvasHasInk ? elements.canvas.toDataURL('image/png') : '',
      synopsis: existing && !titleChanged ? (existing.synopsis || '줄거리를 찾는 중이에요.') : '줄거리를 찾는 중이에요.',
      date: existing?.date || localDateString(),
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    await putBook(book);
    await refreshBooks();
    showView('home-view');
    showToast(existing ? '독후감을 고쳤어요.' : '책꽂이에 새 책을 꽂았어요.');
    if (!existing || titleChanged || !existing.synopsis || existing.synopsis === '줄거리를 찾는 중이에요.') {
      updateSynopsis(book.id, book.title).catch(() => {});
    }
  } catch (error) {
    console.error('독후감을 저장하지 못했습니다.', error);
    showToast('저장하지 못했어요. 잠시 후 다시 해주세요.');
  } finally {
    elements.saveBook.disabled = false;
  }
}

function renderCalendar() {
  const year = state.calendarDate.getFullYear();
  const month = state.calendarDate.getMonth();
  elements.calendarTitle.textContent = `${year}년 ${month + 1}월`;
  elements.prevMonth.disabled = year === 2026 && month === 8;
  elements.calendarGrid.replaceChildren();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const datesWithBooks = new Set(state.books.map((book) => book.date));

  for (let index = 0; index < 42; index += 1) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'calendar-day';
    const day = index - firstWeekday + 1;
    if (day < 1 || day > daysInMonth) {
      button.classList.add('other');
      button.tabIndex = -1;
    } else {
      const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const span = document.createElement('span');
      span.textContent = day;
      button.append(span);
      button.setAttribute('aria-label', formatDate(date));
      if (date < MIN_DATE) {
        button.classList.add('disabled');
        button.disabled = true;
      } else if (datesWithBooks.has(date)) {
        button.classList.add('marked');
        button.setAttribute('aria-label', `${formatDate(date)}, 독후감 있음`);
        button.addEventListener('click', () => selectCalendarDay(date));
      }
      if (state.selectedDate === date) button.classList.add('selected');
    }
    elements.calendarGrid.append(button);
  }
  renderSelectedDay();
}

function selectCalendarDay(date) {
  state.selectedDate = date;
  renderCalendar();
}

function renderSelectedDay() {
  elements.dayBooks.replaceChildren();
  if (!state.selectedDate) return;
  const books = state.books.filter((book) => book.date === state.selectedDate);
  if (!books.length) return;
  const heading = document.createElement('h3');
  heading.textContent = `${formatDate(state.selectedDate)}의 책`;
  elements.dayBooks.append(heading);
  books.forEach((book) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'day-book';
    button.textContent = book.title;
    button.addEventListener('click', () => openDetail(book.id, 'calendar-view'));
    elements.dayBooks.append(button);
  });
}

function changeMonth(offset) {
  const next = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() + offset, 1);
  if (next < MIN_MONTH) return;
  state.calendarDate = next;
  state.selectedDate = '';
  renderCalendar();
}

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add('show');
  toastTimer = setTimeout(() => elements.toast.classList.remove('show'), 2200);
}

async function dailyBackup() {
  const today = localDateString();
  if (localStorage.getItem('bookclip-last-backup') === today) return;
  try {
    const exportedArray = await getAllBooks();
    const response = await fetch('https://appointee-unnoticed-donated.ngrok-free.dev/api/app-backup/bookclip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(exportedArray)
    });
    if (response.ok) localStorage.setItem('bookclip-last-backup', today);
  } catch (_) {
    // Backup is best-effort because the receiving computer may be offline.
  }
}

function bindEvents() {
  elements.navButtons.forEach((button) => button.addEventListener('click', () => {
    showView(button.dataset.view);
    if (button.dataset.view === 'calendar-view') renderCalendar();
  }));
  elements.addBook.addEventListener('click', () => openEditor());
  elements.editorBack.addEventListener('click', () => showView(state.editingId ? 'detail-view' : 'home-view'));
  elements.detailBack.addEventListener('click', () => showView(state.returnView));
  elements.editBook.addEventListener('click', () => {
    const book = state.books.find((item) => item.id === state.activeBookId);
    if (book) openEditor(book);
  });
  elements.form.addEventListener('submit', saveBook);
  elements.reviewInput.addEventListener('input', autoGrowTextarea);
  elements.clearDrawing.addEventListener('click', resetCanvas);
  elements.canvas.addEventListener('pointerdown', startDrawing);
  elements.canvas.addEventListener('pointermove', draw);
  elements.canvas.addEventListener('pointerup', stopDrawing);
  elements.canvas.addEventListener('pointercancel', stopDrawing);
  elements.prevMonth.addEventListener('click', () => changeMonth(-1));
  elements.nextMonth.addEventListener('click', () => changeMonth(1));
}

async function init() {
  bindEvents();
  resetCanvas();
  try {
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
    await refreshBooks();
  } catch (error) {
    console.error('저장된 독후감을 불러오지 못했습니다.', error);
    showToast('저장 공간을 열지 못했어요.');
  }
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {}));
  }
  setTimeout(dailyBackup, 4000);
}

init();
