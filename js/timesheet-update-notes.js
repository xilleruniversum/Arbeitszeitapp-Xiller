(function () {
	'use strict';

	const timesheet = window.Timesheet;
	if (!timesheet) return;
	const translate = (message, parameters = {}) => t('timesheet', message, parameters);
	let initialization;
	let manualOpening;

	function historyEnabled() {
		return document.getElementById('timesheet-app')?.dataset.updateNotesEnabled === 'true';
	}

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

	function showHistory(notes, returnFocus) {
		const previousFocus = returnFocus ?? document.activeElement;
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
		const releases = [...notes.releases].reverse();
		releases.slice(0, 3).forEach((release, index) => addRelease(content, release, index === 0));
		const olderReleases = releases.slice(3);
		if (olderReleases.length > 0) {
			const older = createElement('details', 'ts-update-notes-older');
			older.append(createElement('summary', '', translate('Older versions')));
			olderReleases.forEach(release => addRelease(older, release, false));
			content.append(older);
		}
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
						? previousFocus
						: document.querySelector('#timesheet-app .ts-tab.active') ?? document.getElementById('month-display');
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

	async function loadNotes(mode, returnFocus) {
		try {
			const notes = await timesheet.api('/api/update-notes', { method: 'POST', body: JSON.stringify({ mode }) });
			if (mode === 'automatic') return;
			if (!validateNotes(notes)) throw new Error('Invalid update notes response');
			if (notes.enabled && notes.releases.length > 0) await showHistory(notes, returnFocus);
		} catch (error) {
			console.warn('Update notes could not be loaded:', error);
			if (mode === 'manual') timesheet.notify(translate('The update notes could not be loaded. Please try again.'));
		}
	}

	function openHistory(returnFocus) {
		manualOpening ??= loadNotes('manual', returnFocus).finally(() => { manualOpening = undefined; });
		return manualOpening;
	}

	function appPath(url) {
		return url.pathname.replace(/\/index\.php(?=\/apps\/timesheet\/?$)/, '').replace(/\/$/, '');
	}

	function handleHistoryLink(event) {
		if (event.defaultPrevented || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
		const link = event.target?.closest?.('a[href]');
		if (!link || !historyEnabled()) return;
		const target = link.getAttribute('target')?.toLowerCase();
		if ((target && target !== '_self') || link.getAttribute('download') !== null) return;

		const current = new URL(window.location.href);
		let destination;
		try {
			destination = new URL(link.getAttribute('href'), current);
		} catch {
			return;
		}
		if (destination.origin !== current.origin || appPath(destination) !== appPath(current)
			|| destination.search !== '?update-notes=1' || destination.hash) return;

		// Links still navigate normally from other Nextcloud apps and in new tabs.
		event.preventDefault();
		const fromBell = link.closest('#notifications, [data-app="timesheet"][data-object-type="update_notes"]');
		const bellTrigger = fromBell && document.querySelector('#notifications .header-menu__trigger[aria-expanded="true"]');
		bellTrigger?.click();
		void openHistory(bellTrigger || link);
	}

	async function initialize() {
		if (!historyEnabled()) return;
		if (takeManualOpenRequest() || manualOpening) {
			await openHistory();
		} else {
			// Refresh the native bell without delaying time entry or the introduction.
			void loadNotes('automatic');
		}
	}

	document.addEventListener('click', handleHistoryLink, true);

	timesheet.updateNotes = {
		init() {
			initialization ??= initialize();
			return initialization;
		},
	};
})();
