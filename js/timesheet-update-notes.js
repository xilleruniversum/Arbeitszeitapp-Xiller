(function () {
	'use strict';

	const timesheet = window.Timesheet;
	if (!timesheet) return;
	const translate = (message, parameters = {}) => t('timesheet', message, parameters);
	let initialization;

	function createElement(tag, className = '', text = '') {
		const element = document.createElement(tag);
		if (className) element.className = className;
		if (text) element.textContent = text;
		return element;
	}

	function takeManualOpenRequest() {
		const url = new URL(window.location.href);
		if (url.searchParams.get('update-notes') !== '1') return false;
		url.searchParams.delete('update-notes');
		try { window.history.replaceState(window.history.state, '', url.href); } catch {}
		return true;
	}

	function validateNotes(notes) {
		if (!notes || typeof notes.enabled !== 'boolean' || !Array.isArray(notes.releases)) return false;
		if (notes.releases.length === 0) return true;
		if (typeof notes.throughVersion !== 'string' || notes.throughVersion.length === 0) return false;
		return notes.releases.every(release => release && typeof release.version === 'string' && Array.isArray(release.sections)
			&& release.sections.length > 0 && release.sections.every(section => section && typeof section.title === 'string'
				&& Array.isArray(section.items) && section.items.length > 0 && section.items.every(item => typeof item === 'string')));
	}

	function addRelease(content, release, expanded) {
		const releaseSection = createElement('details', 'ts-update-notes-release');
		releaseSection.open = expanded;
		releaseSection.append(createElement('summary', '', translate('Version {version}', { version: release.version })));
		const releaseContent = createElement('div', 'ts-update-notes-release-content');
		for (const section of release.sections) {
			releaseContent.append(createElement('h3', '', section.title));
			const items = createElement('ul');
			for (const item of section.items) items.append(createElement('li', '', item));
			releaseContent.append(items);
		}
		releaseSection.append(releaseContent);
		content.append(releaseSection);
	}

	function showHistory(notes) {
		const previousFocus = document.activeElement;
		const panel = createElement('aside', 'ts-update-notes-panel');
		panel.id = 'ts-update-notes-panel';
		panel.setAttribute('aria-labelledby', 'ts-update-notes-title');
		const heading = createElement('h2', '', translate('Version history'));
		heading.id = 'ts-update-notes-title';
		heading.setAttribute('tabindex', '-1');
		const title = createElement('div');
		title.append(heading, createElement('p', '', translate('Version {version}', { version: notes.throughVersion })));
		const header = createElement('div', 'ts-update-notes-header');
		const closeButton = createElement('button', 'ts-update-notes-close', '×');
		closeButton.type = 'button';
		closeButton.setAttribute('aria-label', translate('Close'));
		header.append(title, closeButton);
		const content = createElement('div', 'ts-update-notes-content');
		[...notes.releases].reverse().forEach((release, index) => addRelease(content, release, index === 0));
		panel.append(header, content);

		return new Promise((resolve, reject) => {
			let confirmationFrame;
			function confirmDisplay() {
				if (document.visibilityState === 'hidden' || !panel.isConnected || !panel.getClientRects().length) return;
				document.removeEventListener('visibilitychange', confirmDisplay);
				window.cancelAnimationFrame(confirmationFrame);
				timesheet.api('/api/update-notes/shown', {
					method: 'POST', body: JSON.stringify({ throughVersion: notes.throughVersion }),
				}).catch(error => console.warn('Update note display could not be saved:', error));
			}
			function removePanel() {
				window.cancelAnimationFrame(confirmationFrame);
				document.removeEventListener('visibilitychange', confirmDisplay);
				const restoreFocus = panel.contains(document.activeElement);
				panel.remove();
				if (restoreFocus) {
					const focusTarget = previousFocus?.isConnected && previousFocus !== document.body
						? previousFocus : document.getElementById('month-display');
					focusTarget?.focus({ preventScroll: true });
				}
			}
			function close() {
				removePanel();
				resolve();
			}
			closeButton.addEventListener('click', close);
			panel.addEventListener('keydown', event => {
				if (event.key === 'Escape') {
					event.preventDefault();
					event.stopPropagation();
					close();
				}
			});
			try {
				document.body.append(panel);
				heading.focus({ preventScroll: true });
				document.addEventListener('visibilitychange', confirmDisplay);
				confirmationFrame = window.requestAnimationFrame(confirmDisplay);
			} catch (error) {
				removePanel();
				reject(error);
			}
		});
	}

	async function loadNotes(mode) {
		try {
			const notes = await timesheet.api('/api/update-notes', { method: 'POST', body: JSON.stringify({ mode }) });
			if (mode === 'automatic') return;
			if (!validateNotes(notes)) throw new Error('Invalid update notes response');
			if (notes.enabled && notes.releases.length > 0) await showHistory(notes);
		} catch (error) {
			console.warn('Update notes could not be loaded:', error);
			if (mode === 'manual') timesheet.notify(translate('The update notes could not be loaded. Please try again.'));
		}
	}

	async function initialize() {
		const root = document.getElementById('timesheet-app');
		if (root?.dataset.updateNotesEnabled !== 'true') return;
		if (takeManualOpenRequest()) {
			await loadNotes('manual');
		} else {
			// Refresh the native bell without delaying time entry or the introduction.
			void loadNotes('automatic');
		}
	}

	timesheet.updateNotes = {
		init() {
			initialization ??= initialize();
			return initialization;
		},
	};
})();
