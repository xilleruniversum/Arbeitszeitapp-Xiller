<?php

declare(strict_types=1);

namespace OCA\Timesheet\Listener;

use OCA\Timesheet\Db\EmploymentStatusStore;
use OCP\AppFramework\Http;
use OCP\AppFramework\OCS\OCSException;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Group\Events\BeforeUserAddedEvent;
use OCP\IGroupManager;
use OCP\IL10N;
use OCP\IUser;
use OCP\Lock\ILockingProvider;
use OCP\Lock\LockedException;

/** @implements IEventListener<BeforeUserAddedEvent> */
class ExclusiveEmploymentGroupListener implements IEventListener {
	public function __construct(
		private IGroupManager $groupManager,
		private ILockingProvider $lockingProvider,
		private IL10N $l10n,
	) {
	}

	public function handle(Event $event): void {
		if (!$event instanceof BeforeUserAddedEvent) {
			return;
		}
		$targetGroup = $event->getGroup()->getGID();
		$currentGroup = match ($targetGroup) {
			EmploymentStatusStore::ACTIVE_GROUP_ID => EmploymentStatusStore::ARCHIVE_GROUP_ID,
			EmploymentStatusStore::ARCHIVE_GROUP_ID => EmploymentStatusStore::ACTIVE_GROUP_ID,
			default => null,
		};
		if ($currentGroup === null) {
			return;
		}

		$user = $event->getUser();
		$key = hash('sha256', 'timesheet:employment-group:' . $user->getUID());
		try {
			$this->lockingProvider->acquireLock($key, ILockingProvider::LOCK_EXCLUSIVE);
		} catch (LockedException) {
			// The current request may already have added the account to the other group.
			$this->assertGroupAvailable($user, $currentGroup, $targetGroup);
			throw new OCSException($this->l10n->t('Changes could not be saved. Please try again.'), Http::STATUS_CONFLICT);
		}
		try {
			$this->assertGroupAvailable($user, $currentGroup, $targetGroup);
		} catch (\Throwable $error) {
			$this->lockingProvider->releaseLock($key, ILockingProvider::LOCK_EXCLUSIVE);
			throw $error;
		}
		// Nextcloud releases the lock at request shutdown, after the membership write.
	}

	private function assertGroupAvailable(IUser $user, string $currentGroup, string $targetGroup): void {
		// Ask the group directly rather than using the request's cached group ID list.
		if ($this->groupManager->get($currentGroup)?->inGroup($user)) {
			throw new OCSException($this->l10n->t(
				'This account already belongs to "%1$s". Remove it from that group before adding it to "%2$s".',
				[$currentGroup, $targetGroup],
			), Http::STATUS_CONFLICT);
		}
	}
}
