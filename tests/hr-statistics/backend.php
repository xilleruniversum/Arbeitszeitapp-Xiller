<?php

declare(strict_types=1);

namespace OC {
	class ForbiddenException extends \RuntimeException {}
}

namespace OCP {
	interface IRequest {
		public function getParams(): array;
	}
}

namespace OCP\AppFramework {
	class Controller {
		public function __construct(string $appName, protected \OCP\IRequest $request) {}
	}
}

namespace OCP\AppFramework\Http {
	class DataResponse {
		public function __construct(public array $data, public int $status = 200) {}
	}
}

namespace OCP\AppFramework\Services {
	interface IAppConfig {
		public function getAppValueString(string $key, string $default): string;
	}
}

namespace OCP\AppFramework\Utility {
	interface ITimeFactory {
		public function getDateTime(string $time, \DateTimeZone $zone): \DateTime;
	}
}

namespace OCA\Timesheet\Db {
	class EntryMapper {
		public array $entries = [];
		public array $reads = [];

		public function readCompletedWorkMinutesForUsers(array $ids, string $from, string $to): iterable {
			$this->reads[] = [$ids, $from, $to];
			foreach ($this->entries as [$userId, $date, $start, $end, $break]) {
				// Simulate a case-insensitive database collation and use the work duration formula.
				if (in_array(strtolower($userId), array_map('strtolower', $ids), true)
					&& $date >= $from && $date <= $to && $start !== null && $end !== null) {
					yield [
						'user_id' => $userId,
						'work_date' => $date,
						'actual_minutes' => (string)max(0, ($end < $start ? $end + 1440 : $end) - $start - ($break ?? 0)),
					];
				}
			}
		}
	}

	class UserConfigMapper {
		public array $configs = [];
		public array $reads = [];

		public function getConfigDataForUsers(array $ids): array {
			$this->reads[] = $ids;
			return array_intersect_key($this->configs, array_fill_keys($ids, true));
		}
	}
}

namespace OCA\Timesheet\Service {
	class HrService {
		public string $account = 'hr-a';
		public array $scopes = ['hr-a' => ['alice', 'bob', 'alice', 'carla', 'empty'], 'hr-b' => ['dora']];
		public int $scopeReads = 0;

		public function isHr(): bool {
			return isset($this->scopes[$this->account]);
		}

		public function getEmployeesForOverview(): array {
			$this->scopeReads++;
			return array_map(static fn (string $id): array => ['id' => $id, 'isActive' => $id !== 'bob'], $this->scopes[$this->account]);
		}
	}

	class HolidayService {
		public array $calls = [];

		public function getHolidays(int $year, string $state): array {
			$this->calls[] = [$year, $state];
			if ($state === 'BE') {
				throw new \RuntimeException('Simulated lookup outage.');
			}
			return ['2024-03-29' => 'Karfreitag', '2024-04-01' => 'Ostermontag'];
		}
	}
}

namespace {
	use OCA\Timesheet\Controller\HrStatisticsController;
	use OCA\Timesheet\Db\EntryMapper;
	use OCA\Timesheet\Db\UserConfigMapper;
	use OCA\Timesheet\Service\HolidayService;
	use OCA\Timesheet\Service\HrService;
	use OCA\Timesheet\Service\HrStatisticsService;
	use OCP\AppFramework\Services\IAppConfig;
	use OCP\AppFramework\Utility\ITimeFactory;
	use OCP\IRequest;

	require_once __DIR__ . '/../../lib/Service/HrStatisticsService.php';
	require_once __DIR__ . '/../../lib/Controller/HrStatisticsController.php';

	function verify(mixed $expected, mixed $actual, string $message): void {
		if ($expected !== $actual) {
			throw new RuntimeException($message . ' Expected ' . var_export($expected, true) . ', got ' . var_export($actual, true));
		}
	}

	$request = new class implements IRequest {
		public array $params = [];
		public function getParams(): array {
			return $this->params;
		}
	};
	$clock = new class implements ITimeFactory {
		public string $reference = '2024-04-03T22:30:00Z';
		public function getDateTime(string $time, DateTimeZone $zone): DateTime {
			return (new DateTime($this->reference))->setTimezone($zone)->modify($time);
		}
	};
	$config = new class implements IAppConfig {
		public string $excludeSpecialDays = '1';
		public function getAppValueString(string $key, string $default): string {
			verify('specialdays_check', $key, 'The configured special-days option is read.');
			return $this->excludeSpecialDays;
		}
	};
	$hr = new HrService();
	$entries = new EntryMapper();
	$userConfigs = new UserConfigMapper();
	$holiday = new HolidayService();
	$controller = new HrStatisticsController('timesheet', $request, new HrStatisticsService($hr, $entries, $userConfigs, $config, $holiday, $clock));
	$stats = static function (array $params) use ($controller, $request): array {
		$request->params = $params;
		$response = $controller->index();
		verify(200, $response->status, 'The statistics request succeeds.');
		verify($response->data['totals']['actualMinutes'], array_sum(array_column($response->data['buckets'], 'actualMinutes')), 'Actual buckets add up.');
		verify($response->data['totals']['targetMinutes'], array_sum(array_column($response->data['buckets'], 'targetMinutes')), 'Target buckets add up.');
		return $response->data;
	};
	$custom = static fn(string $from, string $to, array $ids = []): array => $stats(['period' => 'custom', 'from' => $from, 'to' => $to, 'employeeIds' => $ids]);
	$bucket = static fn(string $from, string $to, int $actual = 0, int $target = 0, bool $hasEntries = false): array => [
		'from' => $from, 'to' => $to, 'actualMinutes' => $actual, 'targetMinutes' => $target, 'hasEntries' => $hasEntries,
	];

	$month = $stats(['period' => 'monthToDate', 'employeeIds' => []]);
	verify(['2024-04-01', '2024-04-04', 'day', 0], [$month['from'], $month['to'], $month['granularity'], $month['employeeCount']], 'Today is determined in Berlin.');
	verify(4, count($month['buckets']), 'Month-to-date stops on today.');
	verify([], $entries->reads, 'An empty employee selection makes no entry query.');

	$year = $stats(['period' => 'yearToDate', 'employeeIds' => []]);
	verify($bucket('2024-04-01', '2024-04-04'), end($year['buckets']), 'Year-to-date contains a partial final month.');
	$lastYear = $stats(['period' => 'previousYear', 'employeeIds' => []]);
	verify('month', $lastYear['granularity'], 'The previous year is shown by month.');
	verify(12, count($lastYear['buckets']), 'The previous year includes every month.');
	verify($bucket('2023-01-01', '2023-01-31'), reset($lastYear['buckets']), 'The previous year starts in January.');
	verify($bucket('2023-12-01', '2023-12-31'), end($lastYear['buckets']), 'The previous year includes December.');

	$days = $custom('2024-01-30', '2024-02-29');
	verify('day', $days['granularity'], 'Thirty-one days including both ends are shown by day.');
	verify(31, count($days['buckets']), 'The leap day is counted.');
	verify($bucket('2024-02-29', '2024-02-29'), end($days['buckets']), 'The last day of the custom period stays visible.');
	$weeks = $custom('2024-01-02', '2024-04-02');
	verify('week', $weeks['granularity'], 'Ninety-two days are shown by week.');
	verify($bucket('2024-01-02', '2024-01-07'), reset($weeks['buckets']), 'The first week is clipped and ends on Sunday.');
	verify($bucket('2024-04-01', '2024-04-02'), end($weeks['buckets']), 'The last week starts on Monday.');
	verify('month', $custom('2024-01-02', '2024-04-03')['granularity'], 'Ninety-three days are shown by month.');
	verify('month', $custom('2022-02-28', '2024-02-27')['granularity'], 'An inclusive two-year period remains monthly.');
	$years = $custom('2022-02-28', '2024-02-28');
	verify('year', $years['granularity'], 'Beyond the inclusive two-year period, values are shown by year.');
	verify($bucket('2022-02-28', '2022-12-31'), reset($years['buckets']), 'The first year is clipped.');
	verify($bucket('2024-01-01', '2024-02-28'), end($years['buckets']), 'The last year is clipped.');
	$dst = $custom('2024-03-30', '2024-04-01');
	verify(3, count($dst['buckets']), 'The spring daylight-saving change does not change the number of days.');

	$entries->entries = [
		['alice', '2024-02-29', 540, 1020, 30],
		['alice', '2024-03-01', 1320, 240, 30],
		['bob', '2024-03-02', 540, 900, null],
		['alice', '2024-03-03', null, null, 0],
		['alice', '2024-03-04', 540, null, 0],
		['bob', '2024-03-04', 0, 480, 0],
		['bob', '2024-03-05', 540, 600, -15],
		['bob', '2024-03-06', 540, 540, 30],
		['alice', '2024-03-29', 540, 780, 0],
		['alice', '2024-04-01', 540, 840, 0],
		['carla', '2024-04-01', 540, 1020, 0],
		['dora', '2024-04-01', 540, 1120, 0],
		['ALICE', '2024-04-01', 540, 1080, 0],
		['alice', '2024-04-02', 540, 1080, 0],
	];
	$userConfigs->configs = [
		'alice' => ['dailyMin' => 420, 'state' => 'BY'],
		'bob' => ['dailyMin' => 0, 'state' => 'null'],
		'carla' => ['dailyMin' => 500, 'state' => 'BE'],
	];
	$ids = ['alice', 'bob', 'alice', 'carla', 'dora', 'empty', 'ALICE'];
	$result = $custom('2024-02-29', '2024-04-01', $ids);
	verify(4, $result['employeeCount'], 'Only distinct authorized users count, including inactive accounts and accounts with no entries.');
	verify([['alice', 'bob', 'carla', 'empty'], '2024-02-29', '2024-04-01'], $entries->reads[0], 'Only the requested authorized employee IDs reach the mapper.');
	verify([['alice', 'bob', 'carla', 'empty']], $userConfigs->reads, 'Current settings are retrieved in one batch.');
	verify([
		$bucket('2024-02-29', '2024-03-03', 1140, 840, true),
		$bucket('2024-03-04', '2024-03-10', 555, 1440, true),
		$bucket('2024-03-11', '2024-03-17'),
		$bucket('2024-03-18', '2024-03-24'),
		$bucket('2024-03-25', '2024-03-31', 240, 0, true),
		$bucket('2024-04-01', '2024-04-01', 780, 500, true),
	], $result['buckets'], 'Buckets reflect newest targets, overnight shifts, pause accounting, partial entries, and holidays.');
	verify(['actualMinutes' => 2715, 'targetMinutes' => 2780], $result['totals'], 'Interval totals exclude foreign entries and dates.');
	verify(true, $result['holidayLookupIncomplete'], 'A regional lookup failure retains the weekday target and raises a warning.');
	verify([[2024, 'BY'], [2024, 'BE']], $holiday->calls, 'Each region is retrieved once per year.');
	$partial = $custom('2024-03-03', '2024-03-04', ['alice']);
	verify([$bucket('2024-03-03', '2024-03-03'), $bucket('2024-03-04', '2024-03-04')], $partial['buckets'], 'Comment-only and partial entries do not count as worked time.');

	$config->excludeSpecialDays = '0';
	$holiday->calls = [];
	$result = $custom('2024-02-29', '2024-04-01', $ids);
	verify(4100, $result['totals']['targetMinutes'], 'Targets include weekends and holidays when the option is disabled.');
	verify(false, $result['holidayLookupIncomplete'], 'Skipping the lookup by configuration does not raise a warning.');
	verify([], $holiday->calls, 'No holiday calls occur when the option is disabled.');

	$hr->account = 'hr-b';
	$otherHr = $custom('2024-04-01', '2024-04-01', $ids);
	verify(1, $otherHr['employeeCount'], 'The same request in a second HR account uses its own scope.');
	verify(['actualMinutes' => 580, 'targetMinutes' => 480], $otherHr['totals'], 'Only the second HR account’s assigned employee is included.');

	$checks = [
		['period' => 'unknown', 'employeeIds' => []],
		['period' => 'custom', 'employeeIds' => [], 'from' => '2023-02-29', 'to' => '2024-04-01'],
		['period' => 'custom', 'employeeIds' => [], 'from' => '2024-04-02', 'to' => '2024-04-01'],
		['period' => 'custom', 'employeeIds' => [], 'from' => '2024-04-02', 'to' => '2024-04-05'],
		['period' => 'custom', 'employeeIds' => [], 'from' => '2024-4-02', 'to' => '2024-04-03'],
		['period' => 'monthToDate', 'employeeIds' => ['alice' => true]],
		['period' => 'monthToDate', 'employeeIds' => [7]],
		['period' => 'monthToDate'],
	];
	$readsBeforeInvalid = $entries->reads;
	foreach ($checks as $request->params) {
		verify(400, $controller->index()->status, 'Invalid filters return HTTP 400.');
	}
	verify($readsBeforeInvalid, $entries->reads, 'Invalid input never reaches the database query.');
	$hr->account = 'employee';
	$scopeReads = $hr->scopeReads;
	$request->params = ['period' => 'monthToDate', 'employeeIds' => ['alice']];
	verify(403, $controller->index()->status, 'A non-HR user receives HTTP 403.');
	verify($scopeReads, $hr->scopeReads, 'A non-HR request never loads employee scope.');

	echo "HR statistics backend checks passed.\n";
}
