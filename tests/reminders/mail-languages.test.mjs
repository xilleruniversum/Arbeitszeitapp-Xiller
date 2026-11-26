import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const settingsSource = readFileSync(new URL('../../js/timesheet-settings-v3.js', import.meta.url), 'utf8');
const germanOriginal = 'German original {entries}';
const englishOriginal = 'English original {entries}';
const englishOriginalsUrl = '/api/hr/notification-mail-originals?language=en_GB';

function control(properties = {}) {
	const listeners = new Map();
	return {
		children: [],
		dataset: {},
		addEventListener(event, handler) {
			listeners.set(event, [...(listeners.get(event) ?? []), handler]);
		},
		fire(event, target = this) {
			return Promise.all((listeners.get(event) ?? []).map(handler => handler({ target, preventDefault() {} })));
		},
		append(node) {
			this.children.push(node);
		},
		setCustomValidity(message) {
			this.validationMessage = message;
		},
		...properties,
	};
}

async function openEditor({ failFirstOriginalLoad = false } = {}) {
	const nodes = new Map();
	function add(id, properties) {
		const node = control(properties);
		nodes.set(id, node);
		return node;
	}

	const inputError = add('hr-notification-input-error');
	const section = add('hr-notifications-section', {
		disabled: true,
		querySelectorAll: () => [],
		querySelector: selector => selector === '#hr-notification-input-error' ? inputError : null,
	});
	const save = add('hr-notification-save', { disabled: true });
	for (const id of ['hr-notification-load-error', 'hr-notification-save-error', 'hr-notification-saved']) add(id);
	const textarea = add('ts-reminder-mail-text');
	const language = add('ts-reminder-mail-language');
	const languageStatus = add('ts-reminder-mail-language-status', {
		dataset: { loading: 'Loading original…', error: 'Original could not be loaded.' },
	});
	for (const suffix of ['audience', 'scope', 'placeholders', 'reset', 'cancel', 'apply']) {
		add('ts-reminder-mail-' + suffix);
	}
	const form = control();
	const dialog = add('ts-reminder-mail-dialog', {
		open: false,
		showModal() { this.open = true; },
		close() {
			this.open = false;
			return this.fire('close');
		},
		querySelector: selector => selector === 'form' ? form : null,
	});
	add('ts-weekly-mail-editor-data', {
		textContent: JSON.stringify({
			language: 'de', originals: { noEntry: germanOriginal }, maxLength: 4000,
			languages: [{ code: 'de', name: 'Deutsch' }, { code: 'en_GB', name: 'English (UK)' }],
		}),
	});
	add('weekly-no-entry-label', { textContent: 'Missing entries' });
	const button = control({
		dataset: { editWeeklyMail: 'noEntry' },
		closest(selector) { return selector === '[data-edit-weekly-mail]' ? this : null; },
		getAttribute: name => name === 'aria-describedby' ? 'weekly-no-entry-label' : null,
	});
	const settings = {
		warningThresholds: {},
		weeklyMailTemplates: { noEntry: { de: 'German saved {entries}', fr: 'French saved {entries}' } },
	};
	const reads = [];
	const saves = [];
	const context = vm.createContext({
		document: {
			getElementById: id => nodes.get(id),
			querySelector: selector => selector === '.hr-group-notifications' ? {} : null,
			createElement: () => control(),
		},
		window: { Timesheet: {
			state: { currentUserId: 'hr' },
			dom: { refresh() {} },
			showHrNotificationSaved() {},
			async api(url, options) {
				if (options?.method === 'PUT') {
					assert.equal(url, '/api/hr/notifications');
					const patch = JSON.parse(options.body);
					saves.push(patch);
					for (const [locale, text] of Object.entries(patch.weeklyMailTemplates.noEntry)) {
						if (text === null) delete settings.weeklyMailTemplates.noEntry[locale];
						else settings.weeklyMailTemplates.noEntry[locale] = text;
					}
					return settings;
				}
				reads.push(url);
				if (url === '/api/hr/notifications') return settings;
				assert.equal(url, englishOriginalsUrl);
				if (failFirstOriginalLoad) {
					failFirstOriginalLoad = false;
					throw new Error('Temporary transport failure');
				}
				return { weekly: { noEntry: englishOriginal } };
			},
		} },
	});
	vm.runInContext(settingsSource, context);
	context.window.Timesheet.config.init();
	await context.window.Timesheet.config.loadHrWarningThresholds();
	const open = () => section.fire('click', button);
	await open();
	return {
		dialog, textarea, language, languageStatus, save, reads, saves, open, settings,
		select(code) {
			language.value = code;
			return language.fire('change');
		},
		apply: () => form.fire('submit'),
		reset: () => nodes.get('ts-reminder-mail-reset').fire('click'),
	};
}

test('weekly email editing preserves drafts when switching languages and only saves changed locales', async () => {
	const app = await openEditor();
	assert.ok(app.dialog.open);
	assert.equal(app.language.value, 'de');
	assert.deepEqual(app.language.children.map(option => option.value), ['de', 'en_GB']);
	assert.equal(app.textarea.value, 'German saved {entries}');
	app.textarea.value = 'German draft {entries}';

	await app.select('en_GB');
	assert.equal(app.textarea.value, englishOriginal);
	assert.equal(app.textarea.lang, 'en-GB');
	app.textarea.value = 'English draft {entries}';
	await app.select('de');
	assert.equal(app.textarea.value, 'German draft {entries}');
	await app.reset();
	assert.equal(app.textarea.value, germanOriginal);
	await app.apply();
	assert.equal(app.dialog.open, false);
	assert.equal(app.save.disabled, false);
	assert.deepEqual(app.saves, []);

	await app.save.fire('click');
	assert.deepEqual(app.saves, [{ weeklyMailTemplates: { noEntry: { de: null, en_GB: 'English draft {entries}' } } }]);
	assert.equal(app.settings.weeklyMailTemplates.noEntry.fr, 'French saved {entries}');
	assert.equal(app.save.disabled, true);

	await app.open();
	assert.equal(app.language.value, 'de');
	assert.equal(app.textarea.value, germanOriginal);
	await app.select('en_GB');
	assert.equal(app.textarea.value, 'English draft {entries}');
	assert.equal(app.reads.filter(url => url === englishOriginalsUrl).length, 1);
});

test('a failed original text load retains the visible draft and allows retrying the same language', async () => {
	const app = await openEditor({ failFirstOriginalLoad: true });
	app.textarea.value = 'Unapplied German {entries}';
	const switching = app.select('en_GB');
	assert.equal(app.textarea.disabled, true);
	await switching;
	assert.equal(app.language.value, 'de');
	assert.equal(app.textarea.value, 'Unapplied German {entries}');
	assert.equal(app.textarea.disabled, false);
	assert.equal(app.languageStatus.textContent, 'Original could not be loaded.');

	await app.select('en_GB');
	assert.equal(app.language.value, 'en_GB');
	assert.equal(app.textarea.value, englishOriginal);
	assert.equal(app.languageStatus.textContent, '');
	await app.select('de');
	assert.equal(app.textarea.value, 'Unapplied German {entries}');
	assert.equal(app.reads.filter(url => url === englishOriginalsUrl).length, 2);
	assert.deepEqual(app.saves, []);
});
