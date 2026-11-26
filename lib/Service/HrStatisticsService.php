<?php

declare(strict_types=1);

namespace OCA\Timesheet\Service;

use DateTimeImmutable;
use DateTimeZone;
use InvalidArgumentException;
use OC\ForbiddenException;
use OCA\Timesheet\Db\EntryMapper;
use OCA\Timesheet\Db\UserConfigMapper;
use OCP\AppFramework\Services\IAppConfig;
use OCP\AppFramework\Utility\ITimeFactory;

class HrStatisticsService {
	private const DEFAULT_WORK_MINUTES = 480;
	private const EMPLOYEE_BATCH_SIZE = 250;

	public function __construct(
		private HrService $hrService,
		private EntryMapper $entryMapper,
		private UserConfigMapper $userConfigMapper,
		private IAppConfig $appConfig,
		private HolidayService $holidayService,
		private ITimeFactory $timeFactory,
	) {
	}

	public function getStatistics(array $query): array {
		if (!$this->hrService->isHr()) {
			throw new ForbiddenException();
		}
		[$from, $to, $granularity] = $this->resolvePeriod($query);
		$employeeIds = $this->selectEmployees($query['employeeIds'] ?? null);
		$fromYmd = $from->format('Y-m-d');
		$toYmd = $to->format('Y-m-d');
		$buckets = $this->createBuckets($from, $to, $granularity);
		$excludeSpecialDays = $this->appConfig->getAppValueString('specialdays_check', '0') === '1';
		$holidayCandidates = [];

		foreach (array_chunk($employeeIds, self::EMPLOYEE_BATCH_SIZE) as $batch) {
			$selectedUsers = array_fill_keys($batch, true);
			$configs = $this->userConfigMapper->getConfigDataForUsers($batch);
			foreach ($this->entryMapper->readCompletedWorkMinutesForUsers($batch, $fromYmd, $toYmd) as $entry) {
				// Keep UID matching exact even with a case-insensitive database collation.
				if (!isset($selectedUsers[$entry['user_id']])) {
					continue;
				}
				$workDate = new DateTimeImmutable($entry['work_date'], $from->getTimezone());
				$bucketKey = $this->bucketStart($workDate, $granularity)->format('Y-m-d');
				$buckets[$bucketKey]['actualMinutes'] += (int)$entry['actual_minutes'];
				$buckets[$bucketKey]['hasEntries'] = true;
				if ($excludeSpecialDays && (int)$workDate->format('N') >= 6) {
					continue;
				}
				$config = $configs[$entry['user_id']] ?? [];
				$dailyMinutes = $config['dailyMin'] ?? self::DEFAULT_WORK_MINUTES;
				if ($dailyMinutes <= 0) {
					$dailyMinutes = self::DEFAULT_WORK_MINUTES;
				}
				$buckets[$bucketKey]['targetMinutes'] += $dailyMinutes;
				$state = trim((string)($config['state'] ?? ''));
				if ($excludeSpecialDays && $state !== '' && $state !== 'null') {
					$year = (int)$workDate->format('Y');
					$date = $entry['work_date'];
					$holidayCandidates[$year][$state][$date] ??= ['bucket' => $bucketKey, 'minutes' => 0];
					$holidayCandidates[$year][$state][$date]['minutes'] += $dailyMinutes;
				}
			}
		}

		// Resolve each region and year once after closing all database cursors.
		$holidayLookupIncomplete = false;
		foreach ($holidayCandidates as $year => $states) {
			foreach ($states as $state => $candidates) {
				try {
					$holidays = $this->holidayService->getHolidays($year, (string)$state);
				} catch (\Throwable) {
					// Retain the weekday target when the regional lookup is unavailable.
					$holidayLookupIncomplete = true;
					continue;
				}
				foreach (array_intersect_key($candidates, $holidays) as $candidate) {
					$buckets[$candidate['bucket']]['targetMinutes'] -= $candidate['minutes'];
				}
			}
		}

		return [
			'from' => $fromYmd,
			'to' => $toYmd,
			'granularity' => $granularity,
			'employeeCount' => count($employeeIds),
			'totals' => [
				'actualMinutes' => array_sum(array_column($buckets, 'actualMinutes')),
				'targetMinutes' => array_sum(array_column($buckets, 'targetMinutes')),
			],
			'buckets' => array_values($buckets),
			'holidayLookupIncomplete' => $holidayLookupIncomplete,
		];
	}

	/** @return string[] */
	private function selectEmployees(mixed $requestedIds): array {
		if (!is_array($requestedIds) || !array_is_list($requestedIds)) {
			throw new InvalidArgumentException('Expected a list of employee IDs.');
		}
		foreach ($requestedIds as $id) {
			if (!is_string($id) || $id === '') {
				throw new InvalidArgumentException('Invalid employee ID.');
			}
		}
		if ($requestedIds === []) {
			return [];
		}

		$accessibleIds = array_column($this->hrService->getEmployeesForOverview(), 'id');
		return array_values(array_intersect(array_unique($requestedIds), $accessibleIds));
	}

	/** @return array{DateTimeImmutable,DateTimeImmutable,string} */
	private function resolvePeriod(array $query): array {
		$zone = new DateTimeZone('Europe/Berlin');
		$today = DateTimeImmutable::createFromMutable($this->timeFactory->getDateTime('today', $zone));
		$yearStart = $today->setDate((int)$today->format('Y'), 1, 1);

		return match ($query['period'] ?? null) {
			'monthToDate' => [$today->modify('first day of this month'), $today, 'day'],
			'yearToDate' => [$yearStart, $today, 'month'],
			'previousYear' => [$yearStart->modify('-1 year'), $yearStart->modify('-1 day'), 'month'],
			'custom' => $this->resolveCustomPeriod($query, $today),
			default => throw new InvalidArgumentException('Invalid statistics period.'),
		};
	}

	/** @return array{DateTimeImmutable,DateTimeImmutable,string} */
	private function resolveCustomPeriod(array $query, DateTimeImmutable $today): array {
		$from = $this->parseDate($query['from'] ?? null, $today->getTimezone());
		$to = $this->parseDate($query['to'] ?? null, $today->getTimezone());
		if ($from > $to || $to > $today) {
			throw new InvalidArgumentException('Invalid statistics date range.');
		}

		$days = $from->diff($to)->days + 1;
		$granularity = match (true) {
			$days <= 31 => 'day',
			$days <= 92 => 'week',
			$to < $from->modify('+2 years') => 'month',
			default => 'year',
		};
		return [$from, $to, $granularity];
	}

	private function parseDate(mixed $value, DateTimeZone $zone): DateTimeImmutable {
		if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}$/D', $value) || str_starts_with($value, '0000-')) {
			throw new InvalidArgumentException('Invalid statistics date.');
		}
		$date = DateTimeImmutable::createFromFormat('!Y-m-d', $value, $zone);
		if (!$date || $date->format('Y-m-d') !== $value) {
			throw new InvalidArgumentException('Invalid statistics date.');
		}
		return $date;
	}

	private function bucketStart(DateTimeImmutable $date, string $granularity): DateTimeImmutable {
		return match ($granularity) {
			'day' => $date,
			'week' => $date->modify('monday this week'),
			'month' => $date->modify('first day of this month'),
			'year' => $date->setDate((int)$date->format('Y'), 1, 1),
		};
	}

	private function createBuckets(DateTimeImmutable $from, DateTimeImmutable $to, string $granularity): array {
		$buckets = [];
		$start = $this->bucketStart($from, $granularity);
		while ($start <= $to) {
			$next = $start->modify('+1 ' . $granularity);
			$buckets[$start->format('Y-m-d')] = [
				'from' => max($start, $from)->format('Y-m-d'),
				'to' => min($next->modify('-1 day'), $to)->format('Y-m-d'),
				'actualMinutes' => 0,
				'targetMinutes' => 0,
				'hasEntries' => false,
			];
			$start = $next;
		}
		return $buckets;
	}
}
