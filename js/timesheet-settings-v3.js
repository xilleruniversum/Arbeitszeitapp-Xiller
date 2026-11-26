(function () {
	"use strict";

	const timesheet = window.Timesheet;
	if (!timesheet) {
		return;
	}
	const appState = timesheet.state;
	const utils = timesheet.util;
	timesheet.config = timesheet.config || {};
	const configModule = timesheet.config;

	// Load user configuration
	async function loadUserConfig(targetUserId) {
		try {
			const userConfig = await timesheet.api(`/api/hr/config/${encodeURIComponent(targetUserId)}`);
			const dailyMinimumMinutes = utils.pickDailyMin(userConfig);
			appState.userConfig = {
				...(userConfig || {}),
				dailyMin: dailyMinimumMinutes,
				workMinutes: dailyMinimumMinutes
			};
			if (dailyMinimumMinutes != null) {
				utils.setConfigInputs(dailyMinimumMinutes, userConfig?.state ?? null);
			} else if (userConfig?.state != null) {
				utils.setConfigInputs(null, userConfig.state);
			}
		} catch (error) {
			console.warn('⚠️ Could not load user configuration', error);
		}
	}

	// The HR list and weekly email use the same personal thresholds.
	let notificationLoad = null;
	let notificationSaveGeneration = 0;
	const weeklyMailData = document.getElementById('ts-weekly-mail-editor-data');
	const weeklyMailEditor = weeklyMailData ? JSON.parse(weeklyMailData.textContent) : null;
	const weeklyMailDrafts = new Map();
	let savedWeeklyMailTemplates = {};

	function setThreshold(input, value) {
		input.value = input.type === 'number' ? String(value) : utils.minToHm(value);
	}

	function loadHrNotificationSettings() {
		const section = document.getElementById('hr-notifications-section');
		if (!appState.currentUserId || !section) return Promise.resolve();
		if (notificationLoad) return notificationLoad;
		if (savedNotificationSettings && configModule.hasPendingHrNotificationSettings?.()) return Promise.resolve();
		const loadGeneration = notificationSaveGeneration;

		notificationLoad = (async () => {
			try {
				const settings = await timesheet.api('/api/hr/notifications');
				if (loadGeneration !== notificationSaveGeneration
					|| (savedNotificationSettings && configModule.hasPendingHrNotificationSettings?.())) return;
				applyHrNotificationSettings(section, settings);
				section.disabled = false;
				document.getElementById('hr-notification-load-error').hidden = true;
				configModule.updateHrNotificationSaveButton?.();
			} catch (error) {
				document.getElementById('hr-notification-load-error').hidden = false;
				console.warn('Could not load HR notification settings', error);
			}
		})().finally(() => { notificationLoad = null; });
		return notificationLoad;
	}

	function readThreshold(input) {
		return input.type === 'number' ? input.valueAsNumber : utils.hmToMin(input.value);
	}

	function readNotificationSettings(section) {
		const inputError = section.querySelector('#hr-notification-input-error');
		const valid = [...section.querySelectorAll('input')].every(input => input.checkValidity());
		inputError.hidden = valid;
		if (!valid) return null;

		const settings = { warningThresholds: {} };
		for (const input of section.querySelectorAll('[data-warning-threshold]')) {
			settings.warningThresholds[input.dataset.warningThreshold] = readThreshold(input);
		}
		for (const input of section.querySelectorAll('[data-mail-enabled]')) {
			settings[input.dataset.mailEnabled] = input.checked;
		}
		return settings;
	}

	let savedNotificationSettings;

	function applyHrNotificationSettings(section, settings) {
		appState.hrWarningThresholds = settings.warningThresholds;
		for (const input of section.querySelectorAll('[data-warning-threshold]')) {
			setThreshold(input, settings.warningThresholds[input.dataset.warningThreshold]);
		}
		for (const input of section.querySelectorAll('[data-mail-enabled]')) {
			input.checked = settings[input.dataset.mailEnabled];
		}
		savedWeeklyMailTemplates = settings.weeklyMailTemplates ?? {};
		savedNotificationSettings = readNotificationSettings(section);
	}

	function initNotificationMailEditor(dialog) {
		const textarea = document.getElementById('ts-reminder-mail-text');
		const languageSelect = document.getElementById('ts-reminder-mail-language');
		const languageStatus = document.getElementById('ts-reminder-mail-language-status');
		const audience = document.getElementById('ts-reminder-mail-audience');
		const scope = document.getElementById('ts-reminder-mail-scope');
		const placeholders = document.getElementById('ts-reminder-mail-placeholders');
		const resetButton = document.getElementById('ts-reminder-mail-reset');
		const applyButton = document.getElementById('ts-reminder-mail-apply');
		const originalsByLanguage = new Map();
		let edit;
		let selection = 0;

		for (const language of weeklyMailEditor.languages) {
			const option = document.createElement('option');
			option.value = language.code;
			option.textContent = language.name;
			languageSelect.append(option);
		}

		function setLoading(loading) {
			textarea.disabled = resetButton.disabled = applyButton.disabled = loading;
		}

		function showLanguage(language, original) {
			edit.visibleLanguage = language;
			edit.visibleOriginal = original;
			languageSelect.value = language;
			textarea.lang = language.split('@')[0].replaceAll('_', '-');
			textarea.value = edit.drafts.get(language)?.body ?? edit.text(language) ?? original;
			textarea.setCustomValidity('');
		}

		function rememberText() {
			const { visibleLanguage: language, visibleOriginal: original } = edit;
			const savedText = edit.text(language);
			const reset = edit.drafts.get(language)?.reset === true && savedText != null && textarea.value === original;
			if (textarea.value === (savedText ?? original) && !reset) edit.drafts.delete(language);
			else edit.drafts.set(language, { body: textarea.value, original, reset });
		}

		async function getOriginal(language, session) {
			if (language === session.language) return session.original;
			if (!originalsByLanguage.has(language)) {
				originalsByLanguage.set(language, timesheet.api('/api/hr/notification-mail-originals?language=' + encodeURIComponent(language)));
			}
			try {
				const originals = await originalsByLanguage.get(language);
				const original = originals?.[session.mode]?.[session.key];
				if (typeof original !== 'string') throw new Error('Invalid email original');
				return original;
			} catch (error) {
				originalsByLanguage.delete(language);
				throw error;
			}
		}

		languageSelect.addEventListener('change', async () => {
			if (!edit) return;
			const language = languageSelect.value;
			const session = edit;
			const request = ++selection;
			rememberText();
			languageStatus.textContent = languageStatus.dataset.loading;
			setLoading(true);
			try {
				const original = await getOriginal(language, session);
				if (edit !== session || selection !== request) return;
				showLanguage(language, original);
				languageStatus.textContent = '';
			} catch {
				if (edit !== session || selection !== request) return;
				languageSelect.value = edit.visibleLanguage;
				languageStatus.textContent = languageStatus.dataset.error;
			} finally {
				if (edit === session && selection === request) setLoading(false);
			}
		});

		textarea.addEventListener('input', () => textarea.setCustomValidity(''));
		resetButton.addEventListener('click', () => {
			const { visibleLanguage: language, visibleOriginal: original } = edit;
			edit.drafts.set(language, { body: original, original, reset: true });
			textarea.value = original;
			textarea.setCustomValidity('');
		});
		document.getElementById('ts-reminder-mail-cancel').addEventListener('click', () => dialog.close());
		dialog.addEventListener('close', () => { if (!dialog.open) edit = null; });
		dialog.querySelector('form').addEventListener('submit', event => {
			event.preventDefault();
			if (!edit || textarea.disabled) return;
			rememberText();
			for (const [language, { body, original }] of edit.drafts) {
				if (body.split('{entries}').length === 2) continue;
				showLanguage(language, original);
				textarea.setCustomValidity(textarea.dataset.invalidPlaceholderMessage);
				textarea.reportValidity();
				return;
			}
			for (const [language, { body, original }] of edit.drafts) {
				edit.apply(language, body === original ? null : body);
			}
			dialog.close();
		});

		return options => {
			edit = { ...options, drafts: new Map() };
			audience.textContent = edit.label;
			scope.textContent = scope.dataset[edit.mode];
			placeholders.textContent = placeholders.dataset[edit.mode];
			textarea.maxLength = edit.maxLength;
			languageStatus.textContent = '';
			setLoading(false);
			showLanguage(edit.language, edit.original);
			dialog.showModal();
		};
	}

	function personalNotificationChanges(settings) {
		const { warningThresholds, ...choices } = settings;
		const patch = Object.fromEntries(
			Object.entries(choices).filter(([key, value]) => value !== savedNotificationSettings[key])
		);
		const thresholds = Object.fromEntries(Object.entries(warningThresholds).filter(
			([key, value]) => value !== savedNotificationSettings.warningThresholds[key]
		));
		if (Object.keys(thresholds).length) patch.warningThresholds = thresholds;
		if (weeklyMailDrafts.size) patch.weeklyMailTemplates = Object.fromEntries(weeklyMailDrafts);
		return patch;
	}

	function initHrNotificationSettings() {
		const section = document.getElementById('hr-notifications-section');
		const saveButton = document.getElementById('hr-notification-save');
		if (!section || !saveButton) return;

		const groupSection = document.querySelector('.hr-group-notifications');
		const errorStatus = document.getElementById('hr-notification-save-error');
		let saving = false;

		function hasPersonalChanges() {
			if (!savedNotificationSettings) return false;
			const draft = readNotificationSettings(section);
			return !draft || Object.keys(personalNotificationChanges(draft)).length > 0;
		}

		function updateSaveButton() {
			saveButton.disabled = saving || !(hasPersonalChanges() || timesheet.hrNotificationRules?.hasChanges());
		}
		configModule.updateHrNotificationSaveButton = updateSaveButton;
		configModule.hasPendingHrNotificationSettings = () => saving || hasPersonalChanges();

		const dialog = document.getElementById('ts-reminder-mail-dialog');
		if (dialog) {
			const openMailEditor = initNotificationMailEditor(dialog);
			configModule.openNotificationMailEditor = openMailEditor;

			if (weeklyMailEditor) section.addEventListener('click', event => {
				const button = event.target.closest('[data-edit-weekly-mail]');
				if (!button || !savedNotificationSettings) return;
				const alert = button.dataset.editWeeklyMail;
				const persistedText = language => savedWeeklyMailTemplates[alert]?.[language] ?? null;
				openMailEditor({
					mode: 'weekly',
					label: document.getElementById(button.getAttribute('aria-describedby')).textContent,
					key: alert,
					language: weeklyMailEditor.language,
					original: weeklyMailEditor.originals[alert],
					text(language) {
						const entries = weeklyMailDrafts.get(alert) ?? {};
						return Object.hasOwn(entries, language) ? entries[language] : persistedText(language);
					},
					maxLength: weeklyMailEditor.maxLength,
					apply(language, text) {
						const entries = { ...weeklyMailDrafts.get(alert) };
						if (text === persistedText(language)) delete entries[language];
						else entries[language] = text;
						if (Object.keys(entries).length) weeklyMailDrafts.set(alert, entries);
						else weeklyMailDrafts.delete(alert);
						errorStatus.textContent = '';
						updateSaveButton();
					}
				});
			});
		}

		section.addEventListener('input', () => {
			errorStatus.textContent = '';
			updateSaveButton();
		});
		saveButton.addEventListener('click', async () => {
			if (saveButton.disabled) return;
			const personal = savedNotificationSettings && readNotificationSettings(section);
			const group = timesheet.hrNotificationRules;
			if (savedNotificationSettings && !personal) {
				section.querySelector('input:invalid')?.reportValidity();
				return;
			}
			const personalPatch = personal ? personalNotificationChanges(personal) : {};
			const groupError = group?.validationError();
			if (groupError) {
				errorStatus.textContent = groupError;
				return;
			}

			saving = true;
			saveButton.disabled = true;
			section.inert = true;
			groupSection.inert = true;
			errorStatus.textContent = '';
			document.getElementById('hr-notification-saved').textContent = '';
			try {
				if (group?.hasChanges()) await group.save();
				if (Object.keys(personalPatch).length) {
					notificationSaveGeneration++;
					const result = await timesheet.api('/api/hr/notifications', {
						method: 'PUT',
						body: JSON.stringify(personalPatch)
					});
					weeklyMailDrafts.clear();
					applyHrNotificationSettings(section, result);
					if (document.getElementById('tab-hr')?.classList.contains('active')) {
						timesheet.hr?.loadHrUserList?.();
					}
				}
				timesheet.showHrNotificationSaved();
			} catch (error) {
				console.error('Failed to save HR notification settings', error);
				errorStatus.textContent = error.notificationMessage || t(appState.appName, 'Changes could not be saved. Please try again.');
			} finally {
				saving = false;
				section.inert = false;
				groupSection.inert = false;
				updateSaveButton();
			}
		});
		void loadHrNotificationSettings();
	}

	// Initialize configuration handlers
	function initializeConfigHandlers() {
		timesheet.dom.refresh();
		const domCache = timesheet.dom;

		// Save configuration button handlers
		(domCache.saveConfigBtns || []).forEach(saveButton => {
			saveButton.addEventListener('click', async () => {
				if (!appState.currentUserId) {
					return;
				}
				const container = saveButton.closest('.hr-config-row') || document;
				const dailyInput = container.querySelector('.config-daily-min') || domCache.dailyMinInputs?.[0];
				const stateInput = container.querySelector('.config-state') || domCache.stateInputs?.[0];
				const timeText = dailyInput?.value || '';
				const stateCode = stateInput?.value || '';
				const dailyMinimumMinutes = utils.hmToMin(timeText) ?? 480;
				const isHrView = !!saveButton.closest('#tab-hr');
				let targetUserId = appState.currentUserId;
				if (isHrView) {
					const selectedUserId = timesheet.dom.hrUserTitle?.querySelector('span')?.textContent?.trim();
					if (selectedUserId) {
						targetUserId = selectedUserId;
					}
				}
				saveButton.disabled = true;
				const saveTarget = JSON.stringify(['config', targetUserId]);
				try {
					const saveRequest = timesheet.api(`/api/hr/config/${encodeURIComponent(targetUserId)}`, {
						method: 'PUT',
						body: JSON.stringify({
							dailyMin: dailyMinimumMinutes,
							state: stateCode
						})
					});
					await (timesheet.entries.trackPendingSave ? timesheet.entries.trackPendingSave(saveRequest, saveTarget) : saveRequest);
					timesheet.entries.clearSaveFailure?.(saveTarget);
					if (targetUserId === appState.currentUserId) {
						appState.userConfig = {
							...(appState.userConfig || {}),
							dailyMin: dailyMinimumMinutes,
							workMinutes: dailyMinimumMinutes,
							state: stateCode
						};
						utils.setConfigInputs(dailyMinimumMinutes, stateCode);
						const firstRow = timesheet.dom.tsBody?.querySelector('tr');
						if (firstRow) {
							timesheet.entries.updateWorkedHours(firstRow);
						}
						await timesheet.entries.refreshOvertimeTotal(appState.currentUserId, document);
					} else {
						const firstHrRow = timesheet.dom.hrUserBody?.querySelector('tr');
						if (firstHrRow) {
							timesheet.entries.updateWorkedHours(firstHrRow);
						}
						await timesheet.entries.refreshOvertimeTotal(targetUserId, document.getElementById('tab-hr'));
					}
				} catch (error) {
					timesheet.notify(t(appState.appName, 'Changes could not be saved. Please try again.'));
				} finally {
					saveButton.disabled = false;
				}
			});
		});

		// Update worked hours when daily minimum changes
		(domCache.dailyMinInputs || []).forEach(input => {
			input.addEventListener('input', () => {
				const isPersonalView = !!input.closest('#tab-mine');
				const isHrView = !!input.closest('#tab-hr');
				if (isPersonalView && timesheet.dom.tsBody) {
					const firstRow = timesheet.dom.tsBody.querySelector('tr');
					if (firstRow) {
						timesheet.entries.updateWorkedHours(firstRow);
					}
				}
				if (isHrView && timesheet.dom.hrUserBody) {
					const firstHrRow = timesheet.dom.hrUserBody.querySelector('tr');
					if (firstHrRow) {
						timesheet.entries.updateWorkedHours(firstHrRow);
					}
				}
			});
		});

		initHrNotificationSettings();
	}

	// Shared configuration interface
	configModule.init = initializeConfigHandlers;
	configModule.loadUserConfig = loadUserConfig;
	configModule.loadHrWarningThresholds = loadHrNotificationSettings;
})();
