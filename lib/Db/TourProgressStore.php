<?php

declare(strict_types=1);

namespace OCA\Timesheet\Db;

use OCP\IConfig;
use OCP\Lock\ILockingProvider;

/** Stores employee tour completion and the account's reminder preference. */
class TourProgressStore {
	public const VERSION = 1;
	private const APP_ID = 'timesheet';
	private const EMPLOYEE_VERSION_KEY = 'tour_employee_version';
	private const REMINDER_DISMISSED_KEY = 'tour_employee_reminder_dismissed';

	public function __construct(private IConfig $userConfig, private ILockingProvider $lockingProvider) {
	}

	/** @return array{version:int,employeeCompleted:bool,employeeReminderDismissed:bool} */
	public function getProgress(string $userId): array {
		return [
			'version' => self::VERSION,
			'employeeCompleted' => $this->readVersion($userId) >= self::VERSION,
			'employeeReminderDismissed' => $this->isReminderDismissed($userId),
		];
	}

	public function markCompleted(string $userId): void {
		$this->withAccountLock($userId, function () use ($userId): void {
			if ($this->readVersion($userId) < self::VERSION) {
				$this->userConfig->setUserValue($userId, self::APP_ID, self::EMPLOYEE_VERSION_KEY, (string)self::VERSION);
			}
		});
	}

	public function dismissReminder(string $userId): void {
		$this->withAccountLock($userId, function () use ($userId): void {
			if (!$this->isReminderDismissed($userId)) {
				$this->userConfig->setUserValue($userId, self::APP_ID, self::REMINDER_DISMISSED_KEY, '1');
			}
		});
	}

	private function withAccountLock(string $userId, callable $write): void {
		// A short, namespaced key fits Nextcloud's database locking provider.
		$lockKey = hash('sha256', 'timesheet:tour-progress:' . $userId);
		$this->lockingProvider->acquireLock($lockKey, ILockingProvider::LOCK_EXCLUSIVE);
		try {
			$write();
		} finally {
			$this->lockingProvider->releaseLock($lockKey, ILockingProvider::LOCK_EXCLUSIVE);
		}
	}

	private function isReminderDismissed(string $userId): bool {
		$values = $this->userConfig->getUserValueForUsers(self::APP_ID, self::REMINDER_DISMISSED_KEY, [$userId]);
		return ($values[$userId] ?? '0') === '1';
	}

	private function readVersion(string $userId): int {
		// Read current values even when authentication already filled the user-config cache.
		$values = $this->userConfig->getUserValueForUsers(self::APP_ID, self::EMPLOYEE_VERSION_KEY, [$userId]);
		$version = filter_var($values[$userId] ?? '0', FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]);
		return $version === false ? 0 : $version;
	}
}
