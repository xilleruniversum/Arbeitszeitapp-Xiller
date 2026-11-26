import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const statusSource = readFileSync(resolve(root, 'js/timesheet-employment-status.js'), 'utf8');
const hrSource = readFileSync(resolve(root, 'js/timesheet-hr-dashboard-v8.js'), 'utf8');
const mainTemplate = readFileSync(resolve(root, 'templates/main.php'), 'utf8');
const statisticsStatusTemplate = mainTemplate.match(/<p id="hr-stats-status"[\s\S]*?<\/p>/)[0];
const copy = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(setImmediate);

const employees = [
	{ id: 'alice', name: 'Alice Meyer', isActive: true, freelancerMode: false, statusRevision: 'alice-1', totalMinutes: 60, overtimeMinutes: 100, lastEntryDate: '2026-10-01', missingEntryReferenceDate: '2026-11-19' },
	{ id: 'bob/slash', name: 'Bob Lane', isActive: true, freelancerMode: true, statusRevision: 'bob-1', totalMinutes: 120, overtimeMinutes: 800, lastEntryDate: '2026-10-01', missingEntryReferenceDate: '2026-10-01' },
	{ id: 'carol', name: 'Carol Example', isActive: false, freelancerMode: false, statusRevision: 'carol-1', totalMinutes: 180, overtimeMinutes: -800, lastEntryDate: '2026-10-01', missingEntryReferenceDate: '2026-10-01' },
	{ id: 'dan', name: 'Dan Example', isActive: false, freelancerMode: true, statusRevision: 'dan-1', totalMinutes: 240, overtimeMinutes: 0, lastEntryDate: null, missingEntryReferenceDate: null },
	{ id: 'emma', name: 'Same Name', isActive: true, freelancerMode: false, statusRevision: 'emma-1', totalMinutes: 30, overtimeMinutes: 0, lastEntryDate: null, missingEntryReferenceDate: null },
	{ id: 'frank', name: 'Same Name', isActive: true, freelancerMode: false, statusRevision: 'frank-1', totalMinutes: 45, overtimeMinutes: 0, lastEntryDate: null, missingEntryReferenceDate: null },
];

// Exercise real status and HR handlers while replacing only the DOM, time and transport.
async function openApp({ available = true, respond = null, records = employees, now = '2026-11-20T12:00:00Z', accountLanguage = null, serverLanguage = accountLanguage, browserLanguage = 'en-GB' } = {}) {
	const elements = new Map();
	const accountTranslations = {};
	const documentEvents = new Map();
	const requests = [];
	const serverRecords = copy(records);
	let document;
	class Element {
		constructor(tagName = 'div', id = '') {
			this.tagName = tagName.toUpperCase(); this.id = id;
			this.children = []; this.parentElement = null; this.dataset = {}; this.style = { setProperty(name, value) { this[name] = value; } };
			this.className = ''; this.textContent = ''; this.value = ''; this.checked = false; this.disabled = false; this.hidden = false;
			this.attributes = new Map(); this.listeners = new Map();
			this.classList = {
				contains: name => this.className.split(/\s+/).includes(name),
				toggle: (name, value) => { const names = new Set(this.className.split(/\s+/).filter(Boolean)); value ? names.add(name) : names.delete(name); this.className = [...names].join(' '); },
			};
			if (id) elements.set(id, this);
		}
		appendChild(child) {
			if (child.nodeType === 11) { for (const item of [...child.children]) this.appendChild(item); return child; }
			this.children.push(child); child.parentElement = this; return child;
		}
		append(...children) { children.forEach(child => this.appendChild(child)); }
		replaceChildren(...children) { this.children = []; this.append(...children); }
		set innerHTML(value) { this.html = value; this.children = []; }
		get innerHTML() { return this.html || ''; }
		setAttribute(name, value) { this.attributes.set(name, String(value)); }
		getAttribute(name) { return this.attributes.get(name) ?? null; }
		addEventListener(name, listener) { this.listeners.set(name, [...(this.listeners.get(name) || []), listener]); }
		matches(selector) { return selector.startsWith('.') ? this.classList.contains(selector.slice(1)) : selector.startsWith('#') ? this.id === selector.slice(1) : this.tagName === selector.toUpperCase(); }
		querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
		querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
		closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
		contains(target) { return target === this || this.children.some(child => child.contains(target)); }
		focus() { document.activeElement = this; }
		getBoundingClientRect() { return { left: 300, top: 80, right: 580, bottom: 240, width: 280, height: 160 }; }
	}
	document = {
		activeElement: null,
		createElement: tag => new Element(tag),
		createDocumentFragment() { const fragment = new Element(); fragment.nodeType = 11; return fragment; },
		getElementById: id => elements.get(id) || null,
		addEventListener(name, listener) { documentEvents.set(name, [...(documentEvents.get(name) || []), listener]); },
	};
	const element = (tag, id, parent = null) => { const result = new Element(tag, id); parent?.appendChild(result); return result; };
	const app = element('section', 'timesheet-app');
	Object.assign(app.dataset, { employmentStatusAvailable: String(available), employmentIsActive: 'true', freelancerMode: 'false', employmentStatusRevision: 'alice-1' });
	for (const id of ['freelancer-mode-switch', 'freelancer-mode-feedback', 'hr-employment-status', 'hr-employment-status-feedback', 'hr-employee-freelancer', 'hr-employee-count', 'hr-employee-list-message', 'hr-employee-list-retry', 'hr-employee-filter-button', 'hr-employee-filter-popup', 'hr-employee-search', 'hr-employee-filter-mode', 'hr-employee-filter-close', 'hr-employee-filter-clear', 'hr-back-button']) element(id.includes('switch') || id.includes('search') ? 'input' : 'div', id, app);
	elements.get('hr-employment-status').tagName = 'SPAN';
	// Simulate a previously selected value restored by the browser.
	elements.get('hr-employee-filter-mode').value = 'all';
	elements.get('hr-employee-filter-popup').hidden = true;
	elements.get('freelancer-mode-switch').className = 'ts-freelancer-toggle-switch';
	const breakSwitch = element('input', 'break-switch', app); breakSwitch.className = 'ts-break-toggle-switch';
	const hrTab = element('div', 'tab-hr', app); hrTab.className = 'active';
	const listSection = element('div', 'hr-userlist-section', hrTab); listSection.className = 'ts-hr-section';
	const list = element('tbody', 'hr-userlist', listSection);
	const detail = element('div', 'hr-user-entries', hrTab); detail.className = 'ts-hr-section'; detail.style.display = 'none';
	const title = element('h4', 'hr-user-title', detail); element('span', '', title);
	element('button', 'hr-stats-button', listSection);
	const statistics = element('section', 'hr-stats-section', listSection); statistics.hidden = true;
	element('button', 'hr-stats-close', statistics);
	element('select', 'hr-stats-period', statistics);
	const custom = element('div', 'hr-stats-custom', statistics); custom.hidden = true;
	element('input', 'hr-stats-from', custom); element('input', 'hr-stats-to', custom);
	const statsStatus = element('p', 'hr-stats-status', statistics);
	const serverTranslations = serverLanguage
		? JSON.parse(readFileSync(resolve(root, 'l10n', serverLanguage + '.json'), 'utf8')).translations
		: {};
	for (const [, attribute, key] of statisticsStatusTemplate.matchAll(/data-([\w-]+)="<\?php p\(\$l->t\('([^']+)'\)\); \?>"/g)) {
		const property = attribute.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
		statsStatus.dataset[property] = serverTranslations[key] ?? key;
	}
	element('button', 'hr-stats-retry', statistics).hidden = true;
	const results = element('div', 'hr-stats-results', statistics); results.hidden = true;
	for (const id of ['range', 'actual', 'target', 'difference', 'chart']) element('div', 'hr-stats-' + id, results);
	element('p', 'hr-stats-holiday-warning', results).hidden = true;
	element('tbody', 'hr-stats-table-body', results);
	for (const id of ['hr-stat-total-overtime', 'hr-stat-employees-overtime', 'hr-stat-total-negative', 'hr-stat-employees-negative', 'hr-stat-sum-overtimes']) element('span', id, statistics);
	class FixedDate extends Date { constructor(...values) { super(...(values.length ? values : [now])); } }
	const minutesToText = minutes => `${minutes < 0 ? '-' : ''}${String(Math.floor(Math.abs(minutes) / 60)).padStart(2, '0')}:${String(Math.abs(minutes) % 60).padStart(2, '0')}`;
	const context = vm.createContext({
		document, Date: FixedDate, AbortController, console: { warn() {} }, innerWidth: 1000, innerHeight: 800,
		navigator: { language: browserLanguage },
		OC: { L10N: { register(app, messages) { assert.equal(app, 'timesheet'); Object.assign(accountTranslations, messages); } } },
		addEventListener() {},
		t: (_app, message, parameters = {}) => Object.entries(parameters).reduce((text, [key, value]) => text.replace(`{${key}}`, value), accountTranslations[message] ?? message),
	});
	context.window = context;
	if (accountLanguage) vm.runInContext(readFileSync(resolve(root, 'l10n', accountLanguage + '.js'), 'utf8'), context);
	context.Timesheet = {
		state: { appName: 'timesheet', currentUserId: 'alice', hrWarningThresholds: { noEntryDays: 14, overtimeThresholdMinutes: 600, negativeOvertimeThresholdMinutes: 600 } },
		dom: { refresh() { this.userListEl = list; this.hrUserEntries = detail; this.hrUserTitle = title; } },
		util: { minToHm: minutesToText, hmToMin: text => { const [hours, minutes] = text.replace('-', '').split(':').map(Number); return (hours * 60 + minutes) * (text.startsWith('-') ? -1 : 1); }, formatDate: date => date.toISOString().slice(0, 10), pickDailyMin: config => config.dailyMin },
		entries: { async loadUserEntries() {}, async refreshOvertimeTotal() {} },
		api: async (path, options = {}) => {
			const request = { path, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null };
			requests.push(copy(request));
			if (respond) { const result = await respond(request, requests.length); if (result !== undefined) return result; }
			if (request.method === 'GET') return path === '/api/hr/userlist' ? copy(serverRecords) : { dailyMin: 480, state: 'BY' };
			assert.equal(path, '/api/preferences/freelancer-mode', 'HR details never submit an activity change');
			const userId = 'alice';
			const record = serverRecords.find(employee => employee.id === userId);
			Object.assign(record, request.body); record.statusRevision += '-next';
			return { isActive: record.isActive, freelancerMode: record.freelancerMode, statusRevision: record.statusRevision };
		},
	};
	vm.runInContext(statusSource, context);
	vm.runInContext(hrSource, context);
	context.Timesheet.employmentStatus.init(); context.Timesheet.hr.init();
	async function fire(target, type) {
		const event = { target, type, key: '', preventDefault() {}, stopPropagation() {} };
		await Promise.all((target.listeners.get(type) || []).map(listener => listener(event)));
		await Promise.all((documentEvents.get(type) || []).map(listener => listener(event)));
	}
	return { context, elements, requests, serverRecords, fire, list, accountTranslations, async load() { await context.Timesheet.hr.loadHrUserList(); }, rows: () => list.children, cell: (row, className) => row.querySelector(`.${className}`) };
}

test('initial reads never write; active employees and their matching statistics are shown by default', async () => {
	const app = await openApp(); await app.load();
	assert.equal(app.elements.get('hr-employee-filter-mode').value, 'active');
	assert.deepEqual(app.rows().map(row => row.querySelector('.hr-load-user').dataset.user), employees.filter(employee => employee.isActive).map(employee => employee.id));
	assert.equal(app.elements.get('hr-stat-total-overtime').textContent, '15:00');
	assert.equal(app.elements.get('hr-stat-total-negative').textContent, '00:00');
	assert.equal(app.elements.get('hr-employee-count').textContent, '4 of 6 employees');
	assert.ok(app.requests.every(request => request.method === 'GET'));
});

test('all four filters, name search and clear keep rows, counts and statistics consistent', async () => {
	const app = await openApp(); await app.load();
	const mode = app.elements.get('hr-employee-filter-mode'); const search = app.elements.get('hr-employee-search');
	for (const [filter, count, balance] of [['active', 4, '15:00'], ['inactive', 2, '-13:20'], ['all', 6, '01:40'], ['freelancers', 2, '13:20']]) {
		mode.value = filter; await app.fire(mode, 'change');
		assert.equal(app.rows().length, count); assert.equal(app.elements.get('hr-stat-sum-overtimes').textContent, balance);
	}
	mode.value = 'all'; await app.fire(mode, 'change'); search.value = ' eXaMpLe '; await app.fire(search, 'input');
	assert.equal(app.rows().length, 2); assert.equal(app.elements.get('hr-stat-sum-overtimes').textContent, '-13:20');
	await app.load(); assert.equal(app.rows().length, 2); assert.equal(search.value, ' eXaMpLe ');
	assert.equal(mode.value, 'all');
	mode.value = 'active'; await app.fire(mode, 'change');
	assert.equal(app.rows().length, 0);
	mode.value = 'inactive'; await app.fire(mode, 'change');
	await app.load(); assert.equal(mode.value, 'inactive'); assert.equal(app.rows().length, 2);
	await app.fire(app.elements.get('hr-employee-filter-clear'), 'click');
	assert.equal(mode.value, 'active'); assert.equal(search.value, ''); assert.equal(app.rows().length, 4);
	assert.equal(app.elements.get('hr-stat-sum-overtimes').textContent, '15:00');
});

function statisticsResponse(request, { actualMinutes = 540, targetMinutes = 480, hasEntries = true, holidayLookupIncomplete = false } = {}) {
	const { period, employeeIds } = request.body;
	const [from, to, granularity] = {
		monthToDate: ['2026-11-01', '2026-11-20', 'day'],
		yearToDate: ['2026-01-01', '2026-11-20', 'month'],
		previousYear: ['2025-01-01', '2025-12-31', 'month'],
		custom: [request.body.from, request.body.to, 'week'],
	}[period];
	return {
		from, to, granularity, employeeCount: employeeIds.length, holidayLookupIncomplete,
		totals: { actualMinutes, targetMinutes },
		buckets: [{ from, to, actualMinutes, targetMinutes, hasEntries }],
	};
}

test('period statistics load lazily and use the same employee selection and values in totals, chart and table', async () => {
	const app = await openApp({ respond: request => {
		if (request.path === '/api/hr/statistics') return statisticsResponse(request, { holidayLookupIncomplete: true });
	} });
	const get = key => app.elements.get('hr-stats-' + key);
	const send = (key, type) => app.fire(get(key), type);
	const requests = () => app.requests.filter(request => request.path === '/api/hr/statistics');
	await app.load();
	assert.equal(requests().length, 0);
	await send('button', 'click');
	assert.equal(get('period').value, 'custom');
	assert.equal(get('custom').hidden, false);
	assert.equal(get('from').value, '2026-11-01');
	assert.equal(get('to').value, '2026-11-20');
	assert.deepEqual(requests()[0].body, {
		period: 'custom', employeeIds: ['alice', 'bob/slash', 'emma', 'frank'],
		from: '2026-11-01', to: '2026-11-20',
	});
	assert.equal(requests()[0].method, 'POST');
	assert.equal(get('results').hidden, false);
	assert.equal(get('holiday-warning').hidden, false);
	assert.deepEqual(['actual', 'target', 'difference'].map(key => get(key).textContent), ['09:00', '08:00', '01:00']);
	assert.deepEqual(get('table-body').children[0].children.slice(1).map(cell => cell.textContent), ['09:00', '08:00', '01:00']);
	assert.equal(get('chart').querySelectorAll('.hr-stats-chart-group').length, get('table-body').children.length);
	assert.equal(get('chart').querySelector('.hr-stats-chart-actual').style['--hr-stats-bar-height'], '90%');
	assert.equal(get('chart').querySelector('.hr-stats-chart-target').style['--hr-stats-bar-height'], '80%');

	await send('close', 'click');
	const mode = app.elements.get('hr-employee-filter-mode'); mode.value = 'all'; await app.fire(mode, 'change');
	const search = app.elements.get('hr-employee-search'); search.value = 'example'; await app.fire(search, 'input');
	assert.equal(requests().length, 1);
	await send('button', 'click');
	assert.deepEqual(requests()[1].body.employeeIds, ['carol', 'dan']);
	search.value = 'no employee'; await app.fire(search, 'input');
	assert.equal(requests().length, 2);
	assert.equal(get('status').textContent, 'No employees match the current filters.');
	assert.equal(get('results').hidden, true);
});

test('period and filter changes ignore late statistics and distinguish errors, empty results and invalid dates', async () => {
	let settleYear;
	const pendingYear = new Promise(resolve => { settleYear = resolve; });
	let previousYearAttempts = 0;
	const app = await openApp({ respond: request => {
		if (request.path !== '/api/hr/statistics') return;
		if (request.body.period === 'yearToDate') return pendingYear;
		if (request.body.period === 'previousYear') {
			if (++previousYearAttempts === 1) throw new Error('Unavailable');
			return statisticsResponse(request, { actualMinutes: 0, targetMinutes: 0, hasEntries: false });
		}
		return statisticsResponse(request);
	} });
	const get = key => app.elements.get('hr-stats-' + key);
	const send = (key, type) => app.fire(get(key), type);
	const requests = () => app.requests.filter(request => request.path === '/api/hr/statistics');
	await app.load();
	await send('button', 'click');
	get('period').value = 'yearToDate'; const stale = send('period', 'change');
	assert.equal(get('results').hidden, true);
	assert.equal(get('status').textContent, 'Loading statistics…');
	get('period').value = 'previousYear'; await send('period', 'change');
	assert.equal(get('status').textContent, 'Statistics could not be loaded.');
	assert.equal(get('retry').hidden, false);
	await send('retry', 'click');
	assert.equal(get('status').textContent, 'No complete time entries in this period.');
	assert.equal(get('retry').hidden, true);

	get('period').value = 'custom'; await send('period', 'change');
	assert.equal(get('custom').hidden, false);
	assert.equal(get('from').value, '2026-11-01');
	assert.equal(get('to').max, '2026-11-20');
	get('from').value = '2024-02-29'; get('to').value = '2024-03-03'; await send('to', 'change');
	assert.deepEqual(requests().at(-1).body, { period: 'custom', employeeIds: ['alice', 'bob/slash', 'emma', 'frank'], from: '2024-02-29', to: '2024-03-03' });
	assert.match(get('range').textContent, /2024/);
	settleYear(statisticsResponse(requests()[1], { actualMinutes: 60 }));
	await stale;
	assert.equal(get('actual').textContent, '09:00');
	assert.match(get('range').textContent, /2024/);

	const count = requests().length;
	get('to').value = '2026-11-21'; await send('to', 'change');
	get('from').value = '2025-02-29'; get('to').value = '2025-03-01'; await send('from', 'change');
	assert.equal(requests().length, count);
	assert.equal(get('status').textContent, 'Select a valid period up to today.');
	assert.equal(get('results').hidden, true);
});

test('statistics uses localized statuses even with no browser catalog', async () => {
	const app = await openApp({ serverLanguage: 'de', respond: request => {
		if (request.path === '/api/hr/statistics') throw new Error('Unavailable');
	} });
	await app.load();
	await app.fire(app.elements.get('hr-stats-button'), 'click');
	assert.equal(app.elements.get('hr-stats-status').textContent, 'Die Statistiken konnten nicht geladen werden.');
	assert.equal(app.elements.get('hr-stats-retry').hidden, false);
});

test('duplicate display names remain separate and freelancer identification is not color-only', async () => {
	const app = await openApp(); await app.load();
	const mode = app.elements.get('hr-employee-filter-mode'); mode.value = 'all'; await app.fire(mode, 'change');
	const duplicateRows = app.rows().filter(row => row.querySelector('.hr-employee-identifier'));
	assert.deepEqual(duplicateRows.map(row => row.querySelector('.hr-employee-identifier').textContent), ['emma', 'frank']);
	const freelancerRows = app.rows().filter(row => row.querySelector('.ts-freelancer-badge'));
	assert.equal(freelancerRows.length, 2); assert.ok(freelancerRows.every(row => row.classList.contains('is-freelancer')));
	const bothStatuses = freelancerRows.find(row => row.querySelector('.ts-inactive-badge'));
	const nameLine = bothStatuses.querySelector('.hr-employee-name-line');
	assert.equal(nameLine.children[0], bothStatuses.querySelector('.hr-load-user'));
	assert.deepEqual(nameLine.children[1].children.map(badge => badge.getAttribute('aria-label')), ['Freelancer', 'Inactive']);
	assert.equal(bothStatuses.querySelector('.ts-inactive-badge').querySelector('.hr-employee-status-compact').textContent, '( I )');
	mode.value = 'active'; await app.fire(mode, 'change');
	assert.equal(app.rows().filter(row => row.querySelector('.ts-freelancer-badge')).length, 1);
});

test('only no-entry warnings are suppressed; phase dates do not replace the actual last-entry column', async () => {
	const app = await openApp(); await app.load(); const mode = app.elements.get('hr-employee-filter-mode'); mode.value = 'all'; await app.fire(mode, 'change');
	const find = id => app.rows().find(row => row.querySelector('.hr-load-user').dataset.user === id);
	assert.equal(app.cell(find('alice'), 'hr-user-days-since').textContent, '50');
	assert.equal(app.cell(find('alice'), 'hr-user-errors').textContent, '');
	assert.equal(app.cell(find('bob/slash'), 'hr-user-errors').textContent, 'Too much overtime');
	assert.equal(app.cell(find('carol'), 'hr-user-errors').textContent, 'Too many negative hours');
	assert.equal(app.cell(find('dan'), 'hr-user-errors').textContent, '');
	assert.equal(app.cell(find('emma'), 'hr-user-errors').textContent, 'No complete time entry yet');
});

test('Berlin midnight controls warning thresholds and actual day counts across daylight-saving changes', async () => {
	for (const [referenceDate, beforeMidnight, afterMidnight] of [
		['2026-05-19', '2026-06-01T21:59:59Z', '2026-06-01T22:00:00Z'],
		['2026-10-19', '2026-11-01T22:59:59Z', '2026-11-01T23:00:00Z'],
		['2026-03-16', '2026-03-29T21:59:59Z', '2026-03-29T22:00:00Z'],
		['2026-10-12', '2026-10-25T22:59:59Z', '2026-10-25T23:00:00Z'],
	]) {
		for (const [now, expectedDays] of [[beforeMidnight, 13], [afterMidnight, 14]]) {
			const records = employees.map(employee => employee.id === 'alice'
				? { ...employee, lastEntryDate: referenceDate, missingEntryReferenceDate: referenceDate }
				: employee);
			const app = await openApp({ records, now }); await app.load();
			const row = app.rows().find(item => item.querySelector('.hr-load-user').dataset.user === 'alice');
			assert.equal(app.cell(row, 'hr-user-days-since').textContent, String(expectedDays), `Berlin calendar days at ${now}`);
			assert.equal(app.cell(row, 'hr-user-errors').textContent.includes('No entry'), expectedDays >= 14, `The fourteen-day warning at ${now}`);
			assert.ok(app.requests.every(request => request.method === 'GET'));
		}
	}
});

test('no matches, no assignments and load failures have different visible states', async () => {
	const app = await openApp(); await app.load(); const search = app.elements.get('hr-employee-search'); search.value = 'nobody'; await app.fire(search, 'input');
	assert.equal(app.elements.get('hr-employee-list-message').textContent, 'No matching employees.');
	assert.equal(app.elements.get('hr-stat-sum-overtimes').textContent, '00:00');
	const inactiveOnly = await openApp({ records: employees.filter(employee => !employee.isActive) }); await inactiveOnly.load();
	assert.equal(inactiveOnly.elements.get('hr-employee-list-message').textContent, 'No matching employees.');
	const empty = await openApp({ records: [] }); await empty.load();
	assert.equal(empty.elements.get('hr-employee-list-message').textContent, 'No employees are assigned.');
	const failed = await openApp({ respond: request => { if (request.method === 'GET') throw new Error('Unavailable'); } }); await failed.load();
	assert.equal(failed.elements.get('hr-employee-list-message').textContent, 'Employee list could not be loaded.');
	assert.equal(failed.elements.get('hr-employee-list-retry').hidden, false);
});

test('the self switch persists only its own flag and keeps a separate revision from break preferences', async () => {
	const app = await openApp(); const input = app.elements.get('freelancer-mode-switch');
	input.checked = true; await app.fire(input, 'change');
	assert.deepEqual(app.requests[0], { path: '/api/preferences/freelancer-mode', method: 'PUT', body: { freelancerMode: true, statusRevision: 'alice-1' } });
	assert.equal(input.checked, true); assert.equal(input.disabled, false);
	assert.equal(app.elements.get('break-switch').checked, false);
	assert.ok(app.requests.every(request => !request.path.includes('break-input-mode')));
});

test('pending saves disable duplicate choices; failures roll back and a later save still works', async () => {
	let release; let writes = 0;
	const app = await openApp({ respond: async request => { if (request.method === 'PUT' && ++writes === 1) await new Promise((_resolve, reject) => { release = reject; }); } });
	const input = app.elements.get('freelancer-mode-switch'); input.checked = true;
	const pending = app.fire(input, 'change'); await flush();
	assert.equal(input.disabled, true); assert.equal(input.checked, true);
	await app.fire(input, 'change'); assert.equal(writes, 1);
	release(new Error('Failed')); await pending;
	assert.equal(input.checked, false); assert.equal(input.disabled, false);
	assert.equal(app.elements.get('freelancer-mode-feedback').textContent, 'Employment status could not be saved.');
	input.checked = true; await app.fire(input, 'change'); assert.equal(input.checked, true);
});

test('a conflict restores returned server state and the next request uses its revision', async () => {
	let writes = 0;
	const app = await openApp({ respond: request => {
		if (request.method !== 'PUT') return;
		if (++writes === 1) throw new Error(JSON.stringify({ code: 'employment_status_conflict', isActive: false, freelancerMode: false, statusRevision: 'server-42' }));
		return { isActive: false, freelancerMode: true, statusRevision: 'server-43' };
	} });
	const input = app.elements.get('freelancer-mode-switch'); input.checked = true; await app.fire(input, 'change');
	assert.equal(input.checked, false); assert.match(app.elements.get('freelancer-mode-feedback').textContent, /another window/);
	input.checked = true; await app.fire(input, 'change'); assert.equal(app.requests[1].body.statusRevision, 'server-42');
});

test('unavailable initial state stays disabled and does not write', async () => {
	const app = await openApp({ available: false });
	assert.equal(app.elements.get('freelancer-mode-switch').disabled, true);
	assert.match(app.elements.get('freelancer-mode-feedback').textContent, /could not be loaded/);
	await app.fire(app.elements.get('freelancer-mode-switch'), 'change'); assert.equal(app.requests.length, 0);
});

test('HR details display the selected account status without providing an activity write', async () => {
	const app = await openApp(); await app.load();
	const row = app.rows().find(item => item.querySelector('.hr-load-user').dataset.user === 'bob/slash');
	await app.fire(row.querySelector('.hr-load-user'), 'click');
	assert.equal(app.elements.get('hr-employee-freelancer').hidden, false);
	const activity = app.elements.get('hr-employment-status');
	assert.equal(activity.tagName, 'SPAN');
	assert.equal(activity.textContent, 'Active');
	// A stale change event from the former control cannot change a group-derived status.
	activity.value = 'inactive'; await app.fire(activity, 'change');
	assert.equal(app.requests.filter(request => request.method === 'PUT').length, 0);
	assert.equal(app.serverRecords[1].isActive, true);
	assert.equal(app.elements.get('freelancer-mode-switch').checked, false);
	assert.equal(app.elements.get('hr-employee-freelancer').hidden, false);
});

test('updated server status changes the detail label and filters without changing any account', async () => {
	const app = await openApp(); await app.load();
	const mode = app.elements.get('hr-employee-filter-mode'); mode.value = 'all'; await app.fire(mode, 'change');
	const employee = app.serverRecords[1];
	app.context.Timesheet.employmentStatus.setHrEmployee(employee.id, employee);
	assert.equal(app.elements.get('hr-employment-status').textContent, 'Active');
	employee.isActive = false;
	app.context.Timesheet.employmentStatus.setHrEmployee(employee.id, employee);
	assert.equal(app.elements.get('hr-employment-status').textContent, 'Inactive');
	assert.equal(app.elements.get('hr-employee-freelancer').hidden, false);
	await app.load();
	assert.equal(app.rows().length, 6);
	const isEmployeeRow = row => row.querySelector('.hr-load-user').dataset.user === employee.id;
	assert.ok(app.rows().some(isEmployeeRow));
	mode.value = 'active'; await app.fire(mode, 'change');
	assert.equal(app.rows().length, 3);
	assert.ok(!app.rows().some(isEmployeeRow));
	mode.value = 'inactive'; await app.fire(mode, 'change');
	assert.equal(app.rows().length, 3);
	assert.ok(app.rows().some(isEmployeeRow));
	assert.ok(app.requests.every(request => request.method === 'GET'));
});

test('an unavailable employee status stays unknown instead of being presented as active', async () => {
	const app = await openApp();
	app.context.Timesheet.employmentStatus.setHrEmployee('unknown', null);
	const activity = app.elements.get('hr-employment-status');
	assert.equal(activity.textContent, '-');
	assert.equal(app.elements.get('hr-employee-freelancer').hidden, true);
	assert.match(app.elements.get('hr-employment-status-feedback').textContent, /could not be loaded/);
	activity.value = 'active'; await app.fire(activity, 'change');
	assert.equal(app.requests.length, 0);
});

for (const accountLanguage of ['de', 'de_DE', 'en_GB', 'ja', 'ar']) {
	test('HR warning sentences follow the account language and preserve thresholds: ' + accountLanguage, async () => {
		const records = [
			{ id: 'positive', name: 'Positive', isActive: true, freelancerMode: false, overtimeMinutes: 601, missingEntryReferenceDate: '2026-11-01' },
			{ id: 'negative', name: 'Negative', isActive: true, freelancerMode: false, overtimeMinutes: -601, missingEntryReferenceDate: '2026-11-19' },
			{ id: 'recent', name: 'Recent', isActive: true, freelancerMode: false, overtimeMinutes: 0, missingEntryReferenceDate: '2026-11-19' },
			{ id: 'boundary', name: 'Boundary', isActive: true, freelancerMode: false, overtimeMinutes: 600, missingEntryReferenceDate: '2026-11-06' },
		];
		const app = await openApp({
			records, accountLanguage,
			browserLanguage: accountLanguage === 'en_GB' ? 'de-DE' : 'en-GB',
		});
		await app.load();
		const messages = app.accountTranslations;
		const noEntryKey = 'No entry for at least {days} days';
		assert.equal(typeof messages[noEntryKey], 'string');
		if (!accountLanguage.startsWith('en')) assert.notEqual(messages[noEntryKey], noEntryKey);
		const noEntry = messages[noEntryKey].replace('{days}', '14');
		const findWarning = userId => {
			const row = app.rows().find(item => item.querySelector('.hr-load-user').dataset.user === userId);
			return app.cell(row, 'hr-user-errors').textContent;
		};
		assert.equal(findWarning('positive'), noEntry + ', ' + messages['Too much overtime']);
		assert.equal(findWarning('negative'), messages['Too many negative hours']);
		assert.equal(findWarning('recent'), '');
		assert.equal(findWarning('boundary'), noEntry + ', ' + messages['Too much overtime']);
		assert.doesNotMatch(findWarning('positive'), /\{days\}/);
		assert.ok(app.requests.every(request => request.method === 'GET'));
		if (accountLanguage.startsWith('de')) {
			assert.equal(findWarning('positive'), 'Seit mindestens 14 Tagen kein vollständiger Eintrag, Zu viele Überstunden');
			assert.equal(findWarning('negative'), 'Zu viele Minusstunden');
		}
	});
}

