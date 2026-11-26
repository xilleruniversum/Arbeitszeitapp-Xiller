(function () {
	"use strict";

	const timesheet = window.Timesheet;
	if (!timesheet) {
		return;
	}
	const appState = timesheet.state;
	const utils = timesheet.util;
	timesheet.hr = timesheet.hr || {};
	const hrModule = timesheet.hr;

	// Warning settings and defaults.
	function getWarningThresholds() {
		const warningThresholds = appState.hrWarningThresholds || {};
		const noEntryDays = Number.isFinite(warningThresholds.noEntryDays) ? warningThresholds.noEntryDays : 14;
		const overtimeThresholdMinutes = Number.isFinite(warningThresholds.overtimeThresholdMinutes) ? warningThresholds.overtimeThresholdMinutes : 600;
		const negativeOvertimeThresholdMinutes = Number.isFinite(warningThresholds.negativeOvertimeThresholdMinutes)
			? warningThresholds.negativeOvertimeThresholdMinutes
			: 600;
		return {
			noEntryDays: Math.max(1, Math.min(365, noEntryDays)),
			overtimeThresholdMinutes: Math.max(0, overtimeThresholdMinutes),
			negativeOvertimeThresholdMinutes: Math.max(0, negativeOvertimeThresholdMinutes)
		};
	}

	async function ensureWarningThresholds() {
		if (appState.hrWarningThresholds) {
			return getWarningThresholds();
		}
		if (timesheet.config?.loadHrWarningThresholds) {
			await timesheet.config.loadHrWarningThresholds();
		}
		return getWarningThresholds();
	}

	let allEmployees = [];
	let visibleEmployees = [];
	let listGeneration = 0;
	let listState = 'idle';
	let statistics;
	let initialized = false;
	let listPopups = [];
	const defaultEmployeeFilterMode = 'active';
	const employeeFilter = { mode: defaultEmployeeFilterMode, name: '' };
	const translate = (message, parameters = {}) => t(appState.appName, message, parameters);
	const berlinCalendar = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
	});

	function finiteMinutes(value, fallback = 0) {
		return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
	}

	// The current balances always use the same selection as the employee list.
	function updateHrStats() {
		let positiveMinutes = 0;
		let negativeMinutes = 0;
		let positiveCount = 0;
		let negativeCount = 0;
		for (const employee of visibleEmployees) {
			const balance = finiteMinutes(employee.overtimeMinutes);
			if (balance > 0) { positiveMinutes += balance; positiveCount++; }
			if (balance < 0) { negativeMinutes += balance; negativeCount++; }
		}
		const values = {
			'hr-stat-total-overtime': utils.minToHm(positiveMinutes),
			'hr-stat-employees-overtime': String(positiveCount),
			'hr-stat-total-negative': utils.minToHm(negativeMinutes),
			'hr-stat-employees-negative': String(negativeCount),
			'hr-stat-sum-overtimes': utils.minToHm(positiveMinutes + negativeMinutes),
		};
		for (const [id, value] of Object.entries(values)) {
			const element = document.getElementById(id);
			if (element) element.textContent = value;
		}
	}

	function berlinToday() {
		const parts = Object.fromEntries(berlinCalendar.formatToParts(new Date()).map(part => [part.type, part.value]));
		return `${parts.year}-${parts.month}-${parts.day}`;
	}

	function daysSince(date) {
		if (!date) return null;
		// Compare calendar dates in the same zone used by employment phases and reminders.
		const today = Date.parse(berlinToday());
		const timestamp = Date.parse(date);
		return Number.isFinite(timestamp) ? Math.max(0, Math.floor((today - timestamp) / 86400000)) : null;
	}

	function employeeWarnings(employee) {
		const thresholds = getWarningThresholds();
		const warnings = [];
		const reference = employee.missingEntryReferenceDate === undefined ? employee.lastEntryDate : employee.missingEntryReferenceDate;
		const daysWithoutEntry = daysSince(reference);
		if (employee.isActive && !employee.freelancerMode && (daysWithoutEntry === null || daysWithoutEntry >= thresholds.noEntryDays)) {
			warnings.push(daysWithoutEntry === null
				? translate('No complete time entry yet')
				: translate('No entry for at least {days} days', { days: thresholds.noEntryDays }));
		}
		const balance = finiteMinutes(employee.overtimeMinutes);
		if (balance > 0 && balance >= thresholds.overtimeThresholdMinutes) warnings.push(translate('Too much overtime'));
		else if (balance < 0 && balance <= -thresholds.negativeOvertimeThresholdMinutes) warnings.push(translate('Too many negative hours'));
		return warnings.join(', ');
	}

	function appendCell(row, className, text) {
		const cell = document.createElement('td');
		cell.className = className;
		cell.textContent = text;
		row.appendChild(cell);
		return cell;
	}

	function appendBadgeLabel(badge, className, label) {
		const element = document.createElement('span');
		element.className = className;
		element.textContent = label;
		badge.appendChild(element);
	}

	function appendStatusBadge(statuses, className, labelKey, compactLabel) {
		const label = translate(labelKey);
		const badge = document.createElement('span');
		badge.className = className;
		badge.title = label;
		badge.setAttribute('role', 'img');
		badge.setAttribute('aria-label', label);
		appendBadgeLabel(badge, 'hr-employee-status-label', label);
		appendBadgeLabel(badge, 'hr-employee-status-compact', compactLabel);
		statuses.appendChild(badge);
	}

	function renderEmployees() {
		const body = document.getElementById('hr-userlist');
		if (!body) return;
		const nameQuery = employeeFilter.name.trim().toLowerCase();
		visibleEmployees = allEmployees.filter(employee => {
			const matchesMode = employeeFilter.mode === 'all'
				|| employeeFilter.mode === 'active' && employee.isActive === true
				|| employeeFilter.mode === 'inactive' && employee.isActive === false
				|| employeeFilter.mode === 'freelancers' && employee.freelancerMode === true;
			return matchesMode && String(employee.name || employee.id).toLowerCase().includes(nameQuery);
		});
		const nameCounts = new Map();
		for (const employee of allEmployees) {
			const name = String(employee.name || employee.id);
			nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
		}
		body.replaceChildren();
		for (const employee of visibleEmployees) {
			const row = document.createElement('tr');
			row.classList.toggle('is-freelancer', employeeFilter.mode === 'all' && employee.freelancerMode === true);
			const name = String(employee.name || employee.id);
			const nameCell = appendCell(row, 'hr-employee-name', '');
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'hr-load-user';
			button.dataset.user = String(employee.id);
			button.textContent = name;
			if (nameCounts.get(name) > 1) {
				const identifier = document.createElement('small');
				identifier.className = 'hr-employee-identifier';
				identifier.textContent = String(employee.id);
				button.appendChild(identifier);
			}
			const inactive = employee.isActive === false;
			if (employee.freelancerMode || inactive) {
				const nameLine = document.createElement('div');
				nameLine.className = 'hr-employee-name-line';
				const statuses = document.createElement('div');
				statuses.className = 'hr-employee-statuses';
				if (employee.freelancerMode) appendStatusBadge(statuses, 'ts-freelancer-badge', 'Freelancer', '( F )');
				if (inactive) appendStatusBadge(statuses, 'ts-inactive-badge', 'Inactive', '( I )');
				nameLine.append(button, statuses);
				nameCell.appendChild(nameLine);
			} else {
				nameCell.appendChild(button);
			}
			appendCell(row, 'hr-user-target', utils.minToHm(finiteMinutes(employee.dailyMin, 480)));
			appendCell(row, 'hr-user-balance', utils.minToHm(finiteMinutes(employee.overtimeMinutes)));
			appendCell(row, 'hr-user-last-entry', employee.lastEntryDate ? utils.formatDate(new Date(employee.lastEntryDate)) : '-');
			const actualDays = daysSince(employee.lastEntryDate);
			appendCell(row, 'hr-user-days-since', actualDays === null ? '' : String(actualDays));
			appendCell(row, 'hr-user-errors', employeeWarnings(employee));
			body.appendChild(row);
		}
		const count = document.getElementById('hr-employee-count');
		if (count) count.textContent = translate('{visible} of {total} employees', { visible: visibleEmployees.length, total: allEmployees.length });
		const message = document.getElementById('hr-employee-list-message');
		if (message) message.textContent = !allEmployees.length ? translate('No employees are assigned.') : !visibleEmployees.length ? translate('No matching employees.') : '';
		updateHrStats();
		statistics?.refresh();
	}

	async function loadHrUserList() {
		if (!document.getElementById('hr-userlist')) return;
		const generation = ++listGeneration;
		listState = 'loading';
		statistics?.refresh();
		const message = document.getElementById('hr-employee-list-message');
		const retry = document.getElementById('hr-employee-list-retry');
		if (message) message.textContent = translate('Loading employees…');
		if (retry) retry.hidden = true;
		try {
			await ensureWarningThresholds();
			const employees = await timesheet.api('/api/hr/userlist');
			if (generation !== listGeneration) return;
			if (!Array.isArray(employees)) throw new Error('Invalid HR employee list');
			// UID, rather than display name, identifies a person across groups and edits.
			allEmployees = [...new Map(employees.filter(employee => employee && typeof employee.id === 'string' && employee.id).map(employee => [employee.id, employee])).values()];
			listState = 'ready';
			renderEmployees();
		} catch (error) {
			if (generation !== listGeneration) return;
			listState = 'error';
			allEmployees = [];
			renderEmployees();
			if (message) message.textContent = translate('Employee list could not be loaded.');
			if (retry) retry.hidden = false;
			console.warn('Failed to load HR user list:', error);
		}
	}

	function dateForStatistics(value) {
		return new Date(`${value}T00:00:00Z`);
	}

	function isStatisticsDate(value) {
		if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
		const date = dateForStatistics(value);
		return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
	}

	function initializeStatistics() {
		const get = name => document.getElementById(`hr-stats-${name}`);
		const popup = get('section');
		const period = get('period');
		if (!popup || !period) return;

		const custom = get('custom');
		const from = get('from');
		const to = get('to');
		const status = get('status');
		const retry = get('retry');
		const results = get('results');
		const holidayWarning = get('holiday-warning');
		const chart = get('chart');
		const table = get('table-body');
		const totals = { actual: get('actual'), target: get('target'), difference: get('difference') };
		const range = get('range');
		const button = get('button');
		let requestKey;
		let requestController;

		const accountLocale = window.OC?.getLocale?.() || document.documentElement?.lang || navigator.language;
		let locale;
		try {
			[locale] = Intl.getCanonicalLocales(accountLocale?.replaceAll('_', '-'));
		} catch {}
		const dateOptions = { timeZone: 'UTC', calendar: 'gregory' };
		const fullDate = new Intl.DateTimeFormat(locale, { ...dateOptions, year: 'numeric', month: 'short', day: 'numeric' });
		const dayLabel = new Intl.DateTimeFormat(locale, { ...dateOptions, month: 'short', day: 'numeric' });
		const monthLabel = new Intl.DateTimeFormat(locale, { ...dateOptions, month: 'short', year: '2-digit' });
		const yearLabel = new Intl.DateTimeFormat(locale, { ...dateOptions, year: 'numeric' });
		const number = new Intl.NumberFormat(locale);
		const dateRange = (start, end) => fullDate.formatRange(dateForStatistics(start), dateForStatistics(end));
		const header = document.getElementById('header');

		function position() {
			if (popup.hidden) return;
			timesheet.mailHelp?.positionPopup(popup, button);
			if (header) {
				const minimumTop = header.getBoundingClientRect().bottom + 12;
				if (popup.getBoundingClientRect().top < minimumTop) popup.style.top = `${minimumTop}px`;
			}
		}

		function showStatus(message, canRetry = false) {
			results.hidden = true;
			holidayWarning.hidden = true;
			status.textContent = message;
			retry.hidden = !canRetry;
			position();
		}

		function chartNode(parent, className, text = '') {
			const node = document.createElement('div');
			node.className = className;
			node.textContent = text;
			parent.appendChild(node);
			return node;
		}

		function render(data) {
			if (!data.buckets.some(bucket => bucket.hasEntries)) {
				showStatus(status.dataset.emptyMessage);
				return;
			}

			const { actualMinutes, targetMinutes } = data.totals;
			totals.actual.textContent = utils.minToHm(actualMinutes);
			totals.target.textContent = utils.minToHm(targetMinutes);
			totals.difference.textContent = utils.minToHm(actualMinutes - targetMinutes);
			range.textContent = dateRange(data.from, data.to);

			const peakMinutes = data.buckets.reduce((peak, bucket) => Math.max(peak, bucket.actualMinutes, bucket.targetMinutes), 0);
			const axisHours = Math.max(2, Math.ceil(peakMinutes / 120) * 2);
			const shortDate = data.granularity === 'year' ? yearLabel : data.granularity === 'month' ? monthLabel : dayLabel;
			chart.dataset.granularity = data.granularity;
			chart.replaceChildren();
			table.replaceChildren();
			const axis = chartNode(chart, 'hr-stats-chart-scale');
			for (const hour of [axisHours, axisHours / 2, 0]) chartNode(axis, 'hr-stats-chart-tick', number.format(hour));
			const bars = chartNode(chart, 'hr-stats-chart-bars');
			for (const bucket of data.buckets) {
				const label = dateRange(bucket.from, bucket.to);
				const actual = utils.minToHm(bucket.actualMinutes);
				const target = utils.minToHm(bucket.targetMinutes);
				const difference = utils.minToHm(bucket.actualMinutes - bucket.targetMinutes);
				const group = chartNode(bars, 'hr-stats-chart-group');
				group.title = [label, `${translate('Actual hours')} ${actual}`, `${translate('Target hours')} ${target}`].join('\n');
				const columns = chartNode(group, 'hr-stats-chart-columns');
				const actualBar = chartNode(columns, 'hr-stats-chart-actual');
				const targetBar = chartNode(columns, 'hr-stats-chart-target');
				actualBar.style.setProperty('--hr-stats-bar-height', `${bucket.actualMinutes / (axisHours * 60) * 100}%`);
				targetBar.style.setProperty('--hr-stats-bar-height', `${bucket.targetMinutes / (axisHours * 60) * 100}%`);
				chartNode(group, 'hr-stats-chart-label', shortDate.format(dateForStatistics(bucket.from)));

				const row = document.createElement('tr');
				for (const value of [label, actual, target, difference]) appendCell(row, '', value);
				table.appendChild(row);
			}
			status.textContent = '';
			retry.hidden = true;
			results.hidden = false;
			holidayWarning.hidden = !data.holidayLookupIncomplete;
			position();
		}

		function cancelRequest() {
			requestController?.abort();
			requestController = undefined;
			requestKey = undefined;
		}

		async function refresh() {
			if (popup.hidden) return;
			const today = berlinToday();
			custom.hidden = period.value !== 'custom';
			from.max = today;
			to.max = today;
			if (!custom.hidden) {
				if (!isStatisticsDate(from.value) || !isStatisticsDate(to.value) || from.value > to.value || to.value > today) {
					cancelRequest();
					showStatus(status.dataset.invalidPeriodMessage);
					return;
				}
			}

			if (listState !== 'ready' || visibleEmployees.length === 0) {
				cancelRequest();
				if (listState === 'error') showStatus(status.dataset.employeeLoadErrorMessage, true);
				else if (listState === 'ready') showStatus(status.dataset.noEmployeesMessage);
				else showStatus(status.dataset.employeeLoadingMessage);
				return;
			}

			const query = { period: period.value, employeeIds: visibleEmployees.map(employee => employee.id).sort() };
			if (!custom.hidden) {
				query.from = from.value;
				query.to = to.value;
			}
			const key = JSON.stringify(query);
			if (key === requestKey) return;
			cancelRequest();
			requestKey = key;
			const controller = new AbortController();
			requestController = controller;
			showStatus(status.dataset.loadingMessage);
			try {
				const data = await timesheet.api('/api/hr/statistics', {
					method: 'POST', body: key, signal: controller.signal,
				});
				if (requestController === controller) render(data);
			} catch (error) {
				if (requestController !== controller) return;
				showStatus(status.dataset.errorMessage, true);
				console.warn('Failed to load HR statistics:', error);
			} finally {
				if (requestController === controller) requestController = undefined;
			}
		}

		function selectPeriod() {
			if (period.value === 'custom' && !from.value && !to.value) {
				const today = berlinToday();
				from.value = `${today.slice(0, 7)}-01`;
				to.value = today;
			}
			return refresh();
		}

		period.value = 'custom';
		selectPeriod();
		period.addEventListener('change', selectPeriod);
		from.addEventListener('change', refresh);
		to.addEventListener('change', refresh);
		retry.addEventListener('click', () => {
			cancelRequest();
			return listState === 'error' ? loadHrUserList() : refresh();
		});
		if (typeof ResizeObserver === 'function') new ResizeObserver(position).observe(popup);
		return { refresh, position, visibilityChanged: open => open ? refresh() : cancelRequest() };
	}

	function closeListPopups() {
		listPopups.forEach(popup => popup.close());
	}

	function positionListPopups() {
		listPopups.forEach(popup => popup.position());
	}

	function bindListPopup(buttonId, popupId, closeId, { focusId = closeId, visibilityChanged, positionPopup = timesheet.mailHelp?.positionPopup } = {}) {
		const button = document.getElementById(buttonId);
		const popup = document.getElementById(popupId);
		if (!button || !popup) return null;

		function close(restoreFocus = false) {
			if (popup.hidden) return;
			popup.hidden = true;
			button.setAttribute('aria-expanded', 'false');
			visibilityChanged?.(false);
			if (restoreFocus) button.focus({ preventScroll: true });
		}

		const position = () => positionPopup?.(popup, button);

		button.addEventListener('click', () => {
			if (!popup.hidden) {
				close(true);
				return;
			}
			closeListPopups();
			popup.hidden = false;
			button.setAttribute('aria-expanded', 'true');
			position();
			document.getElementById(focusId)?.focus({ preventScroll: true });
			return visibilityChanged?.(true);
		});
		document.getElementById(closeId)?.addEventListener('click', () => close(true));
		popup.addEventListener('keydown', event => {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			event.stopPropagation();
			close(true);
		});
		popup.addEventListener('focusout', event => {
			if (event.relatedTarget && event.relatedTarget !== button && !popup.contains(event.relatedTarget)) close();
		});
		document.addEventListener('click', event => {
			if (!popup.hidden && !popup.contains(event.target) && !button.contains(event.target)) close();
		});
		return { close, position };
	}

	function initializeFilters() {
		statistics = initializeStatistics();
		listPopups = [
			bindListPopup('hr-stats-button', 'hr-stats-section', 'hr-stats-close', {
				visibilityChanged: statistics?.visibilityChanged,
				positionPopup: statistics?.position,
			}),
			bindListPopup('hr-employee-filter-button', 'hr-employee-filter-popup', 'hr-employee-filter-close', { focusId: 'hr-employee-search' }),
		].filter(Boolean);
		window.addEventListener('resize', positionListPopups);
		window.addEventListener('scroll', positionListPopups, true);

		const search = document.getElementById('hr-employee-search');
		const mode = document.getElementById('hr-employee-filter-mode');
		if (mode) mode.value = employeeFilter.mode;
		search?.addEventListener('input', () => { employeeFilter.name = search.value; renderEmployees(); });
		mode?.addEventListener('change', () => { employeeFilter.mode = mode.value; renderEmployees(); });
		document.getElementById('hr-employee-filter-clear')?.addEventListener('click', () => {
			employeeFilter.mode = defaultEmployeeFilterMode;
			employeeFilter.name = '';
			if (mode) mode.value = employeeFilter.mode;
			if (search) search.value = '';
			renderEmployees();
		});
		document.getElementById('hr-employee-list-retry')?.addEventListener('click', loadHrUserList);
	}

	function initializeViewWidth() {
		const app = document.getElementById('timesheet-app');
		const control = document.getElementById('timesheet-view-width-control');
		const slider = document.getElementById('timesheet-view-width');
		const output = document.getElementById('timesheet-view-width-value');
		if (!app || !control || !slider || !output) return;

		const minimum = Number(slider.min);
		const maximum = Number(slider.max);
		const minimumPanelWidth = 320;
		let availableWidth = 0;
		const storageKey = appState.currentUserId && `timesheet:hr-overview-width:${encodeURIComponent(appState.currentUserId)}`;
		const pendingKey = storageKey && `${storageKey}:pending`;
		const validWidth = width => Number.isInteger(width) && width >= minimum && width <= maximum;
		let legacyWidth = null;
		let pending = null;
		if (storageKey) {
			try { legacyWidth = Number(window.localStorage.getItem(storageKey)); } catch {}
			try { pending = JSON.parse(window.sessionStorage.getItem(pendingKey)); } catch {}
		}
		const storedWidth = Number(slider.dataset.accountWidth);
		let savedWidth = validWidth(storedWidth) ? storedWidth : null;
		let revision = slider.dataset.widthRevision;
		const resumePending = revision && pending?.revision === revision && validWidth(pending.width);
		const importLegacy = savedWidth === null && validWidth(legacyWidth);
		let preferredWidth = resumePending ? pending.width : savedWidth ?? (importLegacy ? legacyWidth : Number(slider.defaultValue));
		let saveQueue = Promise.resolve();
		let saveNumber = 0;

		function rememberPending(width) {
			if (!pendingKey) return;
			try {
				if (width === null) window.sessionStorage.removeItem(pendingKey);
				else window.sessionStorage.setItem(pendingKey, JSON.stringify({ width, revision }));
			} catch {} // The account save also works without browser storage.
		}

		function saveWidth(width, automatic = false) {
			const requestNumber = ++saveNumber;
			rememberPending(width);
			saveQueue = saveQueue.then(async () => {
				if (requestNumber !== saveNumber) return;
				try {
					if (!revision) throw new Error('The width preference is unavailable.');
					if (width !== savedWidth) {
						const preference = await timesheet.api('/api/preferences/hr-overview-width', {
							method: 'PUT',
							body: JSON.stringify({ width, revision }),
							keepalive: true,
						});
						savedWidth = preference.width;
						revision = preference.revision;
					}
					if (requestNumber === saveNumber) rememberPending(null);
					else rememberPending(preferredWidth);
				} catch (error) {
					let conflict;
					try { conflict = JSON.parse(error.message); } catch {}
					if (conflict?.code === 'preference_conflict') {
						savedWidth = conflict.width;
						revision = conflict.revision;
					}
					if (requestNumber !== saveNumber) return;
					rememberPending(null);
					if (savedWidth !== null) {
						preferredWidth = savedWidth;
						slider.value = String(Math.max(Number(slider.min), preferredWidth));
						applyWidth();
					}
					if (!automatic) timesheet.notify(translate('Changes could not be saved. Please try again.'));
				}
			});
		}

		function showWidthValue() {
			const width = `${slider.value}%`;
			slider.setAttribute('aria-valuetext', width);
			output.value = width;
		}

		function applyWidth() {
			const percent = slider.valueAsNumber;
			app.style.setProperty('--timesheet-view-width', `${percent}%`);
			showWidthValue();
			positionListPopups();
		}

		// Keep the track in place while it is being dragged above the resizable panel.
		slider.addEventListener('input', showWidthValue);
		slider.addEventListener('change', () => {
			preferredWidth = slider.valueAsNumber;
			applyWidth();
			saveWidth(preferredWidth);
		});

		new ResizeObserver(([entry]) => {
			const width = entry.contentRect.width;
			if (width <= 0 || width === availableWidth) return;
			availableWidth = width;

			const fittingMinimum = Math.min(maximum, Math.max(minimum, Math.ceil(100 * minimumPanelWidth / availableWidth)));
			slider.min = String(fittingMinimum);
			slider.value = String(Math.max(fittingMinimum, preferredWidth));
			control.hidden = fittingMinimum === maximum;
			applyWidth();
		}).observe(app);

		if (revision && (resumePending || importLegacy)) saveWidth(preferredWidth, !resumePending);
		else if (pending !== null) rememberPending(null);
	}

	// Initialize HR module
	function initializeHrHandlers() {
		if (initialized) return;
		initialized = true;
		initializeViewWidth();
		if (!document.getElementById('hr-userlist')) return;
		initializeFilters();
		timesheet.employmentStatus?.onChange(() => { if (listState === 'ready') loadHrUserList(); });
		// Load HR user entries on button click
		document.addEventListener('click', async event => {
			const userButton = event.target.closest('.hr-load-user');
			if (!userButton) {
				return;
			}
			const userId = userButton.dataset.user;
			if (!userId) {
				return;
			}
			closeListPopups();
			timesheet.employmentStatus?.setHrEmployee(userId, allEmployees.find(employee => employee.id === userId));
			const tabHrSection = document.getElementById('tab-hr');
			const hrConfigRow = tabHrSection?.querySelector('.hr-config-row');
			const hrDailyMinInput = hrConfigRow?.querySelector('.config-daily-min');
			const hrStateInput = hrConfigRow?.querySelector('.config-state');
			if (tabHrSection) {
				tabHrSection.querySelectorAll('.ts-hr-section').forEach(section => section.style.display = 'none');
			}
			appState.hrCurrentMonth = new Date();
			timesheet.main?.updateHrMonthDisplay?.();
			if (hrDailyMinInput) {
				hrDailyMinInput.value = '08:00';
			}
			if (hrStateInput) {
				hrStateInput.value = '';
			}
			try {
				const userConfig = await timesheet.api(`/api/hr/config/${encodeURIComponent(userId)}`);
				const dailyMinimumMinutes = utils.pickDailyMin(userConfig) ?? 480;
				const state = typeof userConfig?.state === 'string' ? userConfig.state : '';
				if (hrDailyMinInput) {
					hrDailyMinInput.value = utils.minToHm(dailyMinimumMinutes);
				}
				if (hrStateInput) {
					hrStateInput.value = state;
				}
			} catch {
				if (hrDailyMinInput) {
					hrDailyMinInput.value = '08:00';
				}
				if (hrStateInput) {
					hrStateInput.value = '';
				}
			}
			await timesheet.entries.loadUserEntries(userId, appState.hrCurrentMonth);
			await timesheet.entries.refreshOvertimeTotal(userId, document.getElementById('tab-hr'));
			timesheet.dom.refresh();
			if (timesheet.dom.hrUserEntries) {
				timesheet.dom.hrUserEntries.style.display = 'block';
			}
			if (timesheet.dom.hrUserTitle) {
				const span = timesheet.dom.hrUserTitle.querySelector('span');
				if (span) {
					span.textContent = userId;
				}
			}
		});

		// Handle HR back button
		document.getElementById('hr-back-button')?.addEventListener('click', () => {
			const tabHrSection = document.getElementById('tab-hr');
			if (!tabHrSection) {
				return;
			}
			tabHrSection.querySelectorAll('.ts-hr-section').forEach(section => {
				if (section.id === 'hr-user-entries') {
					section.style.display = 'none';
				} else {
					section.style.display = '';
				}
			});
		});
	}

	// Shared HR interface
	hrModule.init = initializeHrHandlers;
	hrModule.loadHrUserList = loadHrUserList;
	hrModule.updateHrStats = updateHrStats;
})();
