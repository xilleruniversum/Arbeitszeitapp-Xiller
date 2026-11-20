import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = readFileSync(resolve(root, 'js/timesheet-update-notes.js'), 'utf8');
const mainSource = readFileSync(resolve(root, 'js/timesheet-main-v2.js'), 'utf8');
const flush = () => new Promise(setImmediate);
const appUrl = 'http://localhost:8133/apps/timesheet/';
const historyUrl = appUrl + '?update-notes=1';
const notes = {
	enabled: true, shouldShow: true, throughVersion: '1.4.5',
	releases: [
		{ version: '1.3.0', sections: [{ title: 'New features', items: ['Freelancer mode is available.'] }] },
		{ version: '1.4.3', sections: [{ title: 'Improvements', items: ['Second release.'] }] },
		{ version: '1.4.5', sections: [{ title: 'Bug fixes', items: ['Most recent release.'] }] },
	],
};

// Real module behavior runs against controlled DOM, visibility and transport boundaries.
function fixture({ enabled = true, url = appUrl, payload = notes, respond, hidden = false, translate = message => message, failAppend = false } = {}) {
	const requests = [];
	const messages = [];
	const warnings = [];
	const frames = new Map();
	const events = new Map();
	let document;
	let frameNumber = 0;
	class Element {
		constructor(tag) {
			this.tagName = tag.toUpperCase(); this.id = ''; this.className = ''; this.children = [];
			this.parentElement = null; this.dataset = {}; this.attributes = new Map(); this.listeners = new Map();
			this.style = {}; this.inert = false; this._text = '';
		}
		set textContent(value) { this._text = String(value); this.children = []; }
		get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
		set innerHTML(_value) { throw new Error('Update content must not be parsed as HTML.'); }
		get isConnected() { return this === document.body || !!this.parentElement?.isConnected; }
		append(...children) {
			if (failAppend && this === document.body && children.some(child => child.className === 'ts-update-notes-panel')) throw new Error('Synthetic append failure');
			for (const child of children) { this.children.push(child); child.parentElement = this; }
		}
		remove() { if (this.parentElement) { const parent = this.parentElement; parent.children = parent.children.filter(child => child !== this); this.parentElement = null; } }
		contains(target) { return this === target || this.children.some(child => child.contains(target)); }
		setAttribute(name, value) { this.attributes.set(name, String(value)); }
		getAttribute(name) { return this.attributes.get(name) ?? null; }
		addEventListener(name, callback) { this.listeners.set(name, [...(this.listeners.get(name) || []), callback]); }
		focus() { document.activeElement = this; }
		getClientRects() { return this.isConnected ? [{}] : []; }
	}
	const descendants = element => element.children.flatMap(child => [child, ...descendants(child)]);
	document = {
		visibilityState: hidden ? 'hidden' : 'visible', activeElement: null,
		createElement: tag => new Element(tag), createElementNS: (_namespace, tag) => new Element(tag),
		getElementById: id => [document.body, ...descendants(document.body)].find(element => element.id === id) || null,
		querySelectorAll: () => [],
		querySelector: () => null,
		addEventListener(name, callback) { events.set(name, [...(events.get(name) || []), callback]); },
		removeEventListener(name, callback) { events.set(name, (events.get(name) || []).filter(listener => listener !== callback)); },
	};
	document.body = new Element('body'); document.body.style.overflow = 'auto';
	const header = new Element('header');
	const app = new Element('section'); app.id = 'timesheet-app'; app.dataset.updateNotesEnabled = String(enabled);
	const month = new Element('button'); month.id = 'month-display'; app.append(month);
	document.body.append(header, app); document.activeElement = month;
	const location = { href: url };
	const replacements = [];
	const historyState = { retained: 'state' };
	const context = vm.createContext({
		document, URL, location,
		history: { state: historyState, replaceState(state, title, href) { replacements.push({ state, title, href }); location.href = href; } },
		requestAnimationFrame(callback) { const id = ++frameNumber; frames.set(id, callback); return id; },
		cancelAnimationFrame(id) { frames.delete(id); },
		t: (_app, key, parameters = {}) => Object.entries(parameters).reduce((text, [name, value]) => text.replace('{' + name + '}', value), translate(key)),
		console: { warn: (...warning) => warnings.push(warning) },
		Timesheet: {
			api: async (path, options) => {
				const request = { path, method: options.method, body: JSON.parse(options.body) };
				requests.push(request);
				if (respond) { const response = await respond(request); if (response !== undefined) return response; }
				return path.endsWith('/shown') ? { throughVersion: payload.throughVersion } : payload;
			},
			notify: message => messages.push(message),
		},
	});
	context.window = context;
	vm.runInContext(source, context);
	return {
		context, document, header, app, month, requests, messages, warnings, replacements,
		init: () => context.Timesheet.updateNotes.init(),
		get: id => document.getElementById(id),
		all: className => descendants(document.body).filter(element => element.className === className),
		async paint() { const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(); await flush(); },
		click(element) { for (const callback of element.listeners.get('click') || []) callback({ target: element }); },
		key(element, key) {
			const event = { key, prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {} };
			while (element) {
				for (const callback of element.listeners.get('keydown') || []) callback(event);
				if (event.prevented) break;
				element = element.parentElement;
			}
			return event;
		},
		visibility(value) { document.visibilityState = value; for (const callback of events.get('visibilitychange') || []) callback(); },
	};
}

test('automatic initialization refreshes the bell once without rendering or acknowledging any new notes', async () => {
	const app = fixture();
	const complete = app.init();
	assert.equal(app.init(), complete);
	await complete;
	await app.paint();
	assert.deepEqual(app.requests, [{ path: '/api/update-notes', method: 'POST', body: { mode: 'automatic' } }]);
	assert.equal(app.get('ts-update-notes-panel'), null);
	assert.equal(app.document.activeElement, app.month);
	assert.equal(app.app.inert, false);
	assert.equal(app.document.body.style.overflow, 'auto');
	assert.deepEqual(app.messages, []);
});

test('an ineligible page neither requests nor displays the history', async () => {
	const app = fixture({ enabled: false, url: historyUrl });
	await app.init();
	assert.deepEqual(app.requests, []);
	assert.equal(app.get('ts-update-notes-panel'), null);
});

test('the bell link opens all releases with the newest expanded and preserves unrelated URL state', async () => {
	const app = fixture({ url: appUrl + '?other=keep&update-notes=1#hr', payload: { ...notes, shouldShow: false } });
	const complete = app.init();
	await flush();
	assert.equal(app.requests[0].body.mode, 'manual');
	assert.equal(app.replacements[0].href, appUrl + '?other=keep#hr');
	assert.equal(app.replacements[0].state.retained, 'state');
	const panel = app.get('ts-update-notes-panel');
	assert.equal(panel.tagName, 'ASIDE');
	assert.equal(panel.getAttribute('aria-labelledby'), 'ts-update-notes-title');
	assert.equal(panel.getAttribute('aria-modal'), null);
	const releases = app.all('ts-update-notes-release');
	assert.deepEqual(releases.map(release => [release.tagName, release.children[0].tagName, release.children[0].textContent, release.open]), [
		['DETAILS', 'SUMMARY', 'Version 1.4.5', true],
		['DETAILS', 'SUMMARY', 'Version 1.4.3', false],
		['DETAILS', 'SUMMARY', 'Version 1.3.0', false],
	]);
	assert.deepEqual(notes.releases.map(release => release.version), ['1.3.0', '1.4.3', '1.4.5']);
	assert.equal(app.header.inert, false);
	assert.equal(app.app.inert, false);
	assert.equal(app.document.body.style.overflow, 'auto');
	await app.paint();
	assert.deepEqual(app.requests[1], { path: '/api/update-notes/shown', method: 'POST', body: { throughVersion: '1.4.5' } });
	app.click(app.all('ts-update-notes-close')[0]);
	await complete;
	assert.equal(app.get('ts-update-notes-panel'), null);
	assert.equal(app.document.activeElement, app.month);
	assert.equal(app.requests.length, 2, 'Closing the panel does not dismiss the bell');
});

test('history content is literal text and title and close controls use account translations', async () => {
	const payload = { ...notes, releases: [{ version: '1.4.5', sections: [{ title: 'Server-translated heading', items: ['<img src=x onerror=alert(1)>'] }] }] };
	const app = fixture({ url: historyUrl, payload, translate: message => ({ 'Version history': 'Versionshistorie', Close: 'Schließen' }[message] || message) });
	const complete = app.init();
	await flush();
	const panel = app.get('ts-update-notes-panel');
	const heading = app.get('ts-update-notes-title');
	const closeButton = app.all('ts-update-notes-close')[0];
	assert.equal(heading.textContent, 'Versionshistorie');
	assert.equal(heading.getAttribute('tabindex'), '-1');
	assert.equal(app.document.activeElement, heading);
	assert.ok(panel.textContent.includes('<img src=x onerror=alert(1)>'));
	assert.ok(panel.textContent.includes('Server-translated heading'));
	assert.equal(closeButton.type, 'button');
	assert.equal(closeButton.textContent, '×');
	assert.equal(closeButton.getAttribute('aria-label'), 'Schließen');
	assert.equal(app.key(heading, 'Tab').prevented, false);
	app.month.focus();
	assert.equal(app.key(app.month, 'Escape').prevented, false);
	assert.equal(app.get('ts-update-notes-panel'), panel);
	heading.focus();
	assert.equal(app.key(heading, 'Escape').prevented, true);
	await complete;
	assert.equal(app.document.activeElement, app.month);
});

test('a hidden tab records viewing only once, when the history actually becomes visible', async () => {
	const app = fixture({ hidden: true, url: historyUrl });
	const complete = app.init();
	await flush();
	await app.paint();
	assert.equal(app.requests.length, 1);
	app.visibility('visible'); await flush();
	assert.equal(app.requests.length, 2);
	app.visibility('visible'); await flush();
	assert.equal(app.requests.length, 2);
	app.click(app.all('ts-update-notes-close')[0]); await complete;
});

test('Escape before the first paint does not record a view', async () => {
	const app = fixture({ url: historyUrl });
	const complete = app.init();
	await flush();
	assert.equal(app.key(app.get('ts-update-notes-title'), 'Escape').prevented, true);
	await app.paint();
	await complete;
	assert.equal(app.requests.length, 1);
});

test('manual transport failure is visible while automatic transport failure stays quiet', async () => {
	for (const manual of [false, true]) {
		const app = fixture({ url: manual ? historyUrl : appUrl, respond: () => { throw new Error('Synthetic transport failure'); } });
		await app.init();
		await flush();
		assert.equal(app.messages.length, manual ? 1 : 0);
		assert.equal(app.get('ts-update-notes-panel'), null);
		assert.equal(app.requests.length, 1);
	}
});

test('malformed, empty and disabled history never open a partial panel', async () => {
	for (const payload of [null, {}, { ...notes, throughVersion: null }, { ...notes, releases: [null] }, { enabled: true, releases: [] }, { ...notes, enabled: false }]) {
		const app = fixture({ payload, url: historyUrl });
		await app.init();
		assert.equal(app.get('ts-update-notes-panel'), null);
		assert.equal(app.requests.length, 1);
	}
});

test('a failed view acknowledgement leaves the history usable', async () => {
	const app = fixture({ url: historyUrl, respond: request => { if (request.path.endsWith('/shown')) throw new Error('Synthetic save failure'); } });
	const complete = app.init();
	await flush();
	await app.paint();
	assert.ok(app.get('ts-update-notes-panel'));
	assert.equal(app.warnings.length, 1);
	app.click(app.all('ts-update-notes-close')[0]); await complete;
	assert.equal(app.requests.length, 2);
});

test('a rendering failure reports the error without recording a viewed release', async () => {
	const app = fixture({ failAppend: true, url: historyUrl });
	await app.init();
	assert.equal(app.get('ts-update-notes-panel'), null);
	assert.equal(app.messages.length, 1);
	assert.equal(app.requests.length, 1);
});

test('application startup offers the tour while a slow bell refresh still runs in the background', async () => {
	let resolveBell;
	const app = fixture({ respond: () => new Promise(resolve => { resolveBell = resolve; }) });
	const context = app.context;
	const sequence = [];
	context.document.readyState = 'complete';
	context.Element = class {}; context.HTMLElement = context.Element;
	context.addEventListener = () => {};
	Object.assign(context.Timesheet, {
		state: { currentUserId: 'employee', currentMonth: new Date(), hrCurrentMonth: new Date() },
		util: { monthLabel: () => 'Current month' }, $: () => null, $$: () => [],
		dom: { refresh() {} }, copy: { init() {} }, hr: { init() {} },
		config: { init() {}, async loadUserConfig() {} },
		entries: { async loadRuleThresholds() {}, async loadUserEntries() { sequence.push('entries'); }, async refreshOvertimeTotal() {} },
		tour: { init() { sequence.push('tour'); } },
	});
	vm.runInContext(mainSource, context);
	await flush();
	assert.deepEqual(sequence, ['entries', 'tour']);
	assert.equal(app.requests[0].body.mode, 'automatic');
	assert.equal(app.get('ts-update-notes-panel'), null);
	resolveBell(notes);
	await flush();
	assert.equal(app.get('ts-update-notes-panel'), null);
});
