'use strict';

const DB_NAME = 'bookclip';
const DB_VERSION = 1;
const STORE_NAME = 'books';
const MIN_DATE = '2026-09-16';
const MIN_MONTH = new Date(2026, 8, 1);
const BOOK_COLORS = ['#C9F0E1', '#F7C6D7', '#F1D49B', '#BFD8F1', '#D9C6EA', '#F2B6A0', '#A9D9D0'];
const SYNOPSIS_LOADING = '줄거리를 찾는 중이에요.';
const SYNOPSIS_MISSING = '줄거리를 찾지 못했어요.';

const state = {
  books: [], activeBookId: null, editingEntryId: null, editorMode: 'new-book',
  returnView: 'home-view', calendarDate: new Date(), selectedDate: ''
};
if (state.calendarDate < MIN_MONTH) state.calendarDate = new Date(MIN_MONTH);

const $ = (selector) => document.querySelector(selector);
const elements = {
  views: [...document.querySelectorAll('.view')], navButtons: [...document.querySelectorAll('.nav-button')],
  bookshelf: $('#bookshelf'), bookCount: $('#book-count'), addBook: $('#add-book'), form: $('#book-form'),
  titleInput: $('#title-input'), pageFrom: $('#page-from'), pageTo: $('#page-to'), reviewInput: $('#review-input'),
  canvas: $('#drawing-canvas'), clearDrawing: $('#clear-drawing'), editorTitle: $('#editor-title'),
  editorEyebrow: $('#editor-eyebrow'), editorCard: $('#editor-card'), editorView: $('#editor-view'),
  inlineEditorClose: $('#inline-editor-close'),
  saveBook: $('#save-book'), editorBack: $('#editor-back'),
  detailBack: $('#detail-back'), detailTitle: $('#detail-title'), detailDate: $('#detail-date'),
  detailSynopsis: $('#detail-synopsis'), detailCover: $('#detail-cover'), detailEntries: $('#detail-entries'),
  addEntry: $('#add-entry'), calendarTitle: $('#calendar-title'), calendarGrid: $('#calendar-grid'),
  prevMonth: $('#prev-month'), nextMonth: $('#next-month'), dayBooks: $('#day-books'), toast: $('#toast')
};

let dbPromise;
let isDrawing = false;
let canvasHasInk = false;
let toastTimer;
let resizeFrame;

function makeId() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

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

async function migrateBooks() {
  const books = await getAllBooks();
  const legacy = books.filter((book) => !Array.isArray(book.entries));
  if (!legacy.length) return books;
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    legacy.forEach((oldBook) => {
      const book = { ...oldBook };
      book.entries = [{
        id: makeId(), pageFrom: null, pageTo: null, review: book.review || '',
        drawing: book.drawing || '', date: book.date || localDateString(),
        createdAt: book.createdAt || new Date().toISOString()
      }];
      delete book.review;
      delete book.drawing;
      delete book.date;
      if (!Object.prototype.hasOwnProperty.call(book, 'coverUrl')) book.coverUrl = '';
      store.put(book);
    });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  return getAllBooks();
}

async function refreshBooks() {
  state.books = (await getAllBooks()).map((book) => ({ ...book, entries: Array.isArray(book.entries) ? book.entries : [] }))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  renderShelf();
  renderCalendar();
}

function showView(viewId) {
  elements.views.forEach((view) => view.classList.toggle('active', view.id === viewId));
  elements.navButtons.forEach((button) => button.classList.toggle('active', button.dataset.view === viewId));
  const main = viewId === 'home-view' || viewId === 'calendar-view';
  elements.addBook.hidden = !main;
  document.querySelector('.bottom-nav').hidden = !main;
  document.body.classList.toggle('home-active', viewId === 'home-view');
  $('#app').focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (viewId === 'home-view') requestAnimationFrame(sizeShelf);
}

function hashTitle(title) {
  let hash = 0;
  for (const char of title) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return Math.abs(hash);
}

function shelfLayout(count) {
  const shelf = elements.bookshelf;
  const rows = 3;
  const availableHeight = Math.max(360, window.innerHeight - shelf.getBoundingClientRect().top - document.querySelector('.bottom-nav').offsetHeight - 8);
  const availableWidth = Math.max(250, shelf.clientWidth - 58);
  const columns = Math.ceil(Math.max(count, 1) / rows);
  const gap = columns > 13 ? 2 : columns > 9 ? 3 : 5;
  const width = Math.max(20, Math.min(46, (availableWidth - gap * (columns - 1)) / columns));
  const rowHeight = availableHeight / rows;
  const density = Math.min(1, Math.max(0, (columns - 7) / 9));
  const height = Math.max(72, Math.min(rowHeight - 24, 150 - density * 27));
  return { rows, columns, gap, width, height, rowHeight, availableHeight };
}

function createShelfIllustration() {
  const rows = 3;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.classList.add('shelf-illustration');
  svg.setAttribute('viewBox', `0 0 600 ${rows * 184 + 44}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `<defs><filter id="wood-wobble" x="-4%" y="-4%" width="108%" height="108%"><feTurbulence type="fractalNoise" baseFrequency=".018 .065" numOctaves="2" seed="11" result="rough"/><feDisplacementMap in="SourceGraphic" in2="rough" scale="2.8" result="wobbled"/><feTurbulence type="fractalNoise" baseFrequency=".55" numOctaves="3" seed="19" result="grain"/><feColorMatrix in="grain" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 .16 0" result="softGrain"/><feBlend in="wobbled" in2="softGrain" mode="multiply"/></filter></defs><path class="wood-panel wood-top" d="M17 25 Q139 17 299 23 Q448 28 583 21 L586 45 Q438 51 300 44 Q151 39 14 47 Z"/><path class="wood-panel wood-side" d="M16 24 Q20 160 17 ${rows * 184 + 26} L42 ${rows * 184 + 29} Q38 285 43 43 Z"/><path class="wood-panel wood-side" d="M558 42 Q562 296 558 ${rows * 184 + 29} L584 ${rows * 184 + 26} Q580 174 583 21 Z"/>`;
  for (let i = 1; i <= rows; i += 1) {
    const y = 28 + i * 184;
    const board = document.createElementNS(ns, 'path');
    board.setAttribute('class', i === rows ? 'wood-panel wood-bottom' : 'wood-panel wood-board');
    board.setAttribute('d', `M25 ${y - 7} Q155 ${y - 12} 300 ${y - 7} T575 ${y - 9} L579 ${y + 12} Q430 ${y + 18} 300 ${y + 12} T21 ${y + 14} Z`);
    svg.append(board);
  }
  return svg;
}

function renderShelf() {
  elements.bookCount.textContent = `${state.books.length}권`;
  elements.bookshelf.replaceChildren();
  const layout = shelfLayout(state.books.length);
  const cabinet = document.createElement('div');
  cabinet.className = 'shelf-cabinet';
  cabinet.style.setProperty('--shelf-count', 3);
  cabinet.append(createShelfIllustration());
  for (let start = 0; start < layout.rows * layout.columns; start += layout.columns) {
    const row = document.createElement('div');
    row.className = 'shelf-row';
    state.books.slice(start, start + layout.columns).forEach((book) => {
      const hash = hashTitle(book.title);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'book-spine';
      button.style.setProperty('--spine-color', BOOK_COLORS[hash % BOOK_COLORS.length]);
      button.style.setProperty('--book-tilt', `${(hash % 5) - 2}deg`);
      if (book.coverUrl) {
        button.classList.add('has-cover');
        button.style.backgroundImage = `linear-gradient(rgba(20,15,12,.18), rgba(20,15,12,.62)), url("${book.coverUrl.replace(/["\\]/g, '')}")`;
      }
      const label = document.createElement('span');
      label.textContent = book.title;
      button.append(label);
      button.setAttribute('aria-label', `${book.title} 상세 보기`);
      button.addEventListener('click', () => openDetail(book.id, 'home-view'));
      row.append(button);
    });
    cabinet.append(row);
  }
  elements.bookshelf.append(cabinet);
  if (!state.books.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<strong>첫 독후감을 적어보세요</strong><p>읽은 책을 기록할 때마다 책꽂이 한 권이 차곡차곡 꽂혀요.</p>';
    elements.bookshelf.append(empty);
  }
  sizeShelf();
}

function sizeShelf() {
  const cabinet = elements.bookshelf.querySelector('.shelf-cabinet');
  if (!cabinet) return;
  const layout = shelfLayout(state.books.length);
  cabinet.style.setProperty('--shelf-count', 3);
  cabinet.style.setProperty('--shelf-height', `${layout.rowHeight}px`);
  cabinet.style.setProperty('--cabinet-height', `${layout.availableHeight}px`);
  cabinet.style.setProperty('--spine-width', `${layout.width}px`);
  cabinet.style.setProperty('--book-height', `${layout.height}px`);
  cabinet.style.setProperty('--shelf-gap', `${layout.gap}px`);
  cabinet.style.setProperty('--spine-font', `${Math.max(9, Math.min(13, layout.width * .32))}px`);
}

function entryPageText(entry) {
  const from = entry.pageFrom;
  const to = entry.pageTo;
  if (from != null && to != null) return `${from}쪽부터 ${to}쪽까지`;
  if (from != null) return `${from}쪽부터`;
  if (to != null) return `${to}쪽까지`;
  return '';
}

function openDetail(id, fromView = state.returnView) {
  restoreEditorCard();
  const book = state.books.find((item) => item.id === id);
  if (!book) return;
  state.activeBookId = id;
  state.returnView = fromView;
  elements.detailTitle.textContent = book.title;
  elements.detailDate.textContent = `${book.entries.length}개의 독서 기록`;
  elements.detailSynopsis.textContent = book.synopsis || SYNOPSIS_MISSING;
  if (book.coverUrl) {
    elements.detailCover.src = book.coverUrl;
    elements.detailCover.alt = `${book.title} 표지`;
    elements.detailCover.hidden = false;
  } else {
    elements.detailCover.removeAttribute('src');
    elements.detailCover.hidden = true;
  }
  renderEntries(book);
  showView('detail-view');
}

function restoreEditorCard() {
  if (elements.editorCard.parentElement !== elements.editorView) elements.editorView.append(elements.editorCard);
  elements.addEntry.hidden = false;
  elements.inlineEditorClose.hidden = true;
}

function renderEntries(book) {
  elements.detailEntries.replaceChildren();
  book.entries.forEach((entry, index) => {
    const article = document.createElement('article');
    article.className = 'entry-card';
    article.tabIndex = 0;
    const head = document.createElement('div');
    head.className = 'entry-head';
    const meta = document.createElement('div');
    const date = document.createElement('strong');
    date.textContent = formatDate(entry.date);
    const pages = document.createElement('span');
    pages.textContent = entryPageText(entry);
    meta.append(date, pages);
    const actions = document.createElement('div');
    actions.className = 'entry-actions';
    const edit = document.createElement('button');
    edit.type = 'button'; edit.className = 'text-button'; edit.textContent = '수정';
    edit.addEventListener('click', () => openEntryEditor(book, entry));
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'text-button delete-entry'; remove.textContent = '삭제';
    remove.addEventListener('click', () => requestEntryDelete(book.id, entry.id, remove));
    actions.append(edit, remove); head.append(meta, actions); article.append(head);
    if (entry.review) { const review = document.createElement('p'); review.className = 'review-copy'; review.textContent = entry.review; article.append(review); }
    if (entry.drawing) { const image = document.createElement('img'); image.className = 'detail-drawing'; image.src = entry.drawing; image.alt = `${index + 1}번째 기록의 그림`; article.append(image); }
    article.addEventListener('dblclick', () => openEntryEditor(book, entry));
    elements.detailEntries.append(article);
  });
}

async function requestEntryDelete(bookId, entryId, button) {
  if (button.dataset.armed !== 'true') {
    button.dataset.armed = 'true';
    button.textContent = '한 번 더 눌러 삭제';
    setTimeout(() => { if (button.isConnected) { button.dataset.armed = ''; button.textContent = '삭제'; } }, 3000);
    return;
  }
  const book = state.books.find((item) => item.id === bookId);
  if (!book) return;
  book.entries = book.entries.filter((entry) => entry.id !== entryId);
  book.updatedAt = new Date().toISOString();
  await putBook(book); await refreshBooks(); openDetail(bookId, state.returnView); showToast('기록을 삭제했어요.');
}

function formatDate(dateString) {
  if (!dateString) return '';
  const [year, month, day] = dateString.split('-').map(Number);
  return `${year}년 ${month}월 ${day}일`;
}

function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function resetCanvas() {
  const context = elements.canvas.getContext('2d');
  context.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
  context.fillStyle = '#fff'; context.fillRect(0, 0, elements.canvas.width, elements.canvas.height); canvasHasInk = false;
}

function loadDrawing(dataUrl) {
  resetCanvas();
  if (!dataUrl) return;
  const image = new Image();
  image.onload = () => { elements.canvas.getContext('2d').drawImage(image, 0, 0, elements.canvas.width, elements.canvas.height); canvasHasInk = true; };
  image.src = dataUrl;
}

function setEditor(book, entry, mode) {
  restoreEditorCard();
  state.editorMode = mode;
  state.activeBookId = book?.id || null;
  state.editingEntryId = entry?.id || null;
  const isNewBook = mode === 'new-book';
  elements.editorTitle.textContent = isNewBook ? '새 독서 기록 쓰기' : mode === 'new-entry' ? '이어서 기록하기' : '독서 기록 고치기';
  elements.editorEyebrow.textContent = isNewBook ? '한 권의 책을 꽂아볼까요' : book.title;
  elements.titleInput.value = book?.title || '';
  elements.titleInput.readOnly = !isNewBook;
  elements.titleInput.closest('label');
  elements.pageFrom.value = entry?.pageFrom ?? '';
  elements.pageTo.value = entry?.pageTo ?? '';
  elements.reviewInput.value = entry?.review || '';
  autoGrowTextarea(); loadDrawing(entry?.drawing || '');
  if (mode === 'new-entry') {
    showView('detail-view');
    elements.addEntry.hidden = true;
    elements.addEntry.after(elements.editorCard);
    elements.inlineEditorClose.hidden = false;
  } else showView('editor-view');
  setTimeout(() => (isNewBook ? elements.titleInput : elements.pageFrom).focus(), 80);
}

function openNewBookEditor() { setEditor(null, null, 'new-book'); }
function openNewEntryEditor() { const book = state.books.find((item) => item.id === state.activeBookId); if (book) setEditor(book, null, 'new-entry'); }
function openEntryEditor(book, entry) { setEditor(book, entry, 'edit-entry'); }

function autoGrowTextarea() { elements.reviewInput.style.height = 'auto'; elements.reviewInput.style.height = `${Math.max(140, elements.reviewInput.scrollHeight)}px`; }
function getCanvasPoint(event) { const rect = elements.canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * elements.canvas.width / rect.width, y: (event.clientY - rect.top) * elements.canvas.height / rect.height }; }
function startDrawing(event) { event.preventDefault(); isDrawing = true; canvasHasInk = true; elements.canvas.setPointerCapture(event.pointerId); const p = getCanvasPoint(event); const c = elements.canvas.getContext('2d'); c.beginPath(); c.moveTo(p.x, p.y); }
function draw(event) { if (!isDrawing) return; event.preventDefault(); const p = getCanvasPoint(event); const c = elements.canvas.getContext('2d'); c.lineTo(p.x, p.y); c.strokeStyle = '#181513'; c.lineWidth = 7; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke(); }
function stopDrawing(event) { if (!isDrawing) return; isDrawing = false; if (elements.canvas.hasPointerCapture(event.pointerId)) elements.canvas.releasePointerCapture(event.pointerId); }

function stripHtml(html) { return (new DOMParser().parseFromString(html, 'text/html').body.textContent || '').replace(/\s+/g, ' ').trim(); }
function secureCover(url) { return url ? url.replace(/^http:/i, 'https:') : ''; }

async function fetchBookMetadata(title) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(`intitle:${title}`)}&maxResults=1&country=KR`, { signal: controller.signal });
    if (!response.ok) throw new Error('lookup failed');
    const info = (await response.json()).items?.[0]?.volumeInfo || {};
    return { synopsis: info.description ? stripHtml(info.description) : SYNOPSIS_MISSING, coverUrl: secureCover(info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || '') };
  } catch (_) { return { synopsis: SYNOPSIS_MISSING, coverUrl: '' }; } finally { clearTimeout(timer); }
}

async function updateBookMetadata(id, title) {
  const metadata = await fetchBookMetadata(title);
  const current = (await getAllBooks()).find((book) => book.id === id);
  if (!current || current.title !== title) return;
  current.synopsis = metadata.synopsis; current.coverUrl = metadata.coverUrl; current.updatedAt = new Date().toISOString();
  await putBook(current); await refreshBooks();
  if (state.activeBookId === id && $('#detail-view').classList.contains('active')) openDetail(id, state.returnView);
}

function numberOrNull(input) { return input.value === '' ? null : Number(input.value); }

async function saveBook(event) {
  event.preventDefault();
  const title = elements.titleInput.value.trim();
  if (!title) { elements.titleInput.focus(); showToast('책 제목을 적어주세요.'); return; }
  const from = numberOrNull(elements.pageFrom); const to = numberOrNull(elements.pageTo);
  if (from != null && to != null && from > to) { elements.pageTo.focus(); showToast('끝 페이지는 시작 페이지보다 커야 해요.'); return; }
  elements.saveBook.disabled = true;
  try {
    const now = new Date().toISOString();
    const entry = { id: state.editingEntryId || makeId(), pageFrom: from, pageTo: to, review: elements.reviewInput.value.trim(), drawing: canvasHasInk ? elements.canvas.toDataURL('image/png') : '', date: localDateString(), createdAt: now };
    let book;
    if (state.editorMode === 'new-book') {
      book = { id: makeId(), title, synopsis: SYNOPSIS_LOADING, coverUrl: '', createdAt: now, updatedAt: now, entries: [entry] };
    } else {
      book = state.books.find((item) => item.id === state.activeBookId);
      if (!book) throw new Error('Book missing');
      if (state.editorMode === 'edit-entry') {
        const old = book.entries.find((item) => item.id === state.editingEntryId);
        entry.date = old?.date || localDateString(); entry.createdAt = old?.createdAt || now;
        book.entries = book.entries.map((item) => item.id === entry.id ? entry : item);
      } else book.entries = [...book.entries, entry];
      book.updatedAt = now;
    }
    await putBook(book); await refreshBooks();
    if (state.editorMode === 'new-book') { showView('home-view'); showToast('책꽂이에 새 책을 꽂았어요.'); updateBookMetadata(book.id, book.title).catch(() => {}); }
    else { openDetail(book.id, state.returnView); showToast(state.editorMode === 'new-entry' ? '새 기록을 이어 붙였어요.' : '기록을 고쳤어요.'); }
  } catch (error) { console.error('독서 기록을 저장하지 못했습니다.', error); showToast('저장하지 못했어요. 잠시 뒤 다시 해주세요.'); }
  finally { elements.saveBook.disabled = false; }
}

function allEntryDates() { return new Set(state.books.flatMap((book) => book.entries.map((entry) => entry.date))); }
function renderCalendar() {
  const year = state.calendarDate.getFullYear(), month = state.calendarDate.getMonth();
  elements.calendarTitle.textContent = `${year}년 ${month + 1}월`; elements.prevMonth.disabled = year === 2026 && month === 8; elements.calendarGrid.replaceChildren();
  const first = new Date(year, month, 1).getDay(), count = new Date(year, month + 1, 0).getDate(), marked = allEntryDates();
  for (let index = 0; index < 42; index += 1) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'calendar-day'; const day = index - first + 1;
    if (day < 1 || day > count) { button.classList.add('other'); button.tabIndex = -1; }
    else {
      const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`; const span = document.createElement('span'); span.textContent = day; button.append(span); button.setAttribute('aria-label', formatDate(date));
      if (date < MIN_DATE) { button.classList.add('disabled'); button.disabled = true; }
      else if (marked.has(date)) { button.classList.add('marked'); button.setAttribute('aria-label', `${formatDate(date)}, 독서 기록 있음`); button.addEventListener('click', () => { state.selectedDate = date; renderCalendar(); }); }
      if (state.selectedDate === date) button.classList.add('selected');
    }
    elements.calendarGrid.append(button);
  }
  renderSelectedDay();
}

function renderSelectedDay() {
  elements.dayBooks.replaceChildren(); if (!state.selectedDate) return;
  const books = state.books.filter((book) => book.entries.some((entry) => entry.date === state.selectedDate)); if (!books.length) return;
  const heading = document.createElement('h3'); heading.textContent = `${formatDate(state.selectedDate)}의 책`; elements.dayBooks.append(heading);
  books.forEach((book) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'day-book';
    if (book.coverUrl) { const image = document.createElement('img'); image.src = book.coverUrl; image.alt = ''; button.append(image); }
    const text = document.createElement('span'); const entryCount = book.entries.filter((entry) => entry.date === state.selectedDate).length; text.textContent = `${book.title}${entryCount > 1 ? ` · ${entryCount}개 기록` : ''}`; button.append(text);
    button.addEventListener('click', () => openDetail(book.id, 'calendar-view')); elements.dayBooks.append(button);
  });
}

function changeMonth(offset) { const next = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() + offset, 1); if (next < MIN_MONTH) return; state.calendarDate = next; state.selectedDate = ''; renderCalendar(); }
function showToast(message) { clearTimeout(toastTimer); elements.toast.textContent = message; elements.toast.classList.add('show'); toastTimer = setTimeout(() => elements.toast.classList.remove('show'), 2200); }

async function dailyBackup() {
  const today = localDateString(); if (localStorage.getItem('bookclip-last-backup') === today) return;
  try { const response = await fetch('https://appointee-unnoticed-donated.ngrok-free.dev/api/app-backup/bookclip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(await getAllBooks()) }); if (response.ok) localStorage.setItem('bookclip-last-backup', today); } catch (_) { /* best effort */ }
}

function bindEvents() {
  elements.navButtons.forEach((button) => button.addEventListener('click', () => { showView(button.dataset.view); if (button.dataset.view === 'calendar-view') renderCalendar(); }));
  elements.addBook.addEventListener('click', openNewBookEditor); elements.addEntry.addEventListener('click', openNewEntryEditor);
  elements.editorBack.addEventListener('click', () => state.editorMode === 'new-book' ? showView('home-view') : openDetail(state.activeBookId, state.returnView));
  elements.inlineEditorClose.addEventListener('click', () => openDetail(state.activeBookId, state.returnView));
  elements.detailBack.addEventListener('click', () => showView(state.returnView)); elements.form.addEventListener('submit', saveBook);
  elements.reviewInput.addEventListener('input', autoGrowTextarea); elements.clearDrawing.addEventListener('click', resetCanvas);
  elements.canvas.addEventListener('pointerdown', startDrawing); elements.canvas.addEventListener('pointermove', draw); elements.canvas.addEventListener('pointerup', stopDrawing); elements.canvas.addEventListener('pointercancel', stopDrawing);
  elements.prevMonth.addEventListener('click', () => changeMonth(-1)); elements.nextMonth.addEventListener('click', () => changeMonth(1));
  window.addEventListener('resize', () => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(renderShelf); });
}

async function init() {
  bindEvents(); resetCanvas();
  try { if (navigator.storage?.persist) navigator.storage.persist().catch(() => {}); await migrateBooks(); await refreshBooks(); }
  catch (error) { console.error('저장된 독서 기록을 불러오지 못했습니다.', error); showToast('저장 공간을 열지 못했어요.'); }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' }).then(reg => reg.update()).catch(() => {});
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloading) return; reloading = true; location.reload(); });
  }
  setTimeout(dailyBackup, 4000);
}

init();
