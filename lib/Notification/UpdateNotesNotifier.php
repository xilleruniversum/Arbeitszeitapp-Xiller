<?php

declare(strict_types=1);

namespace OCA\Timesheet\Notification;

use OCA\Timesheet\Service\UpdateNotesService;
use OCP\L10N\IFactory;
use OCP\Notification\AlreadyProcessedException;
use OCP\Notification\IAction;
use OCP\Notification\IDismissableNotifier;
use OCP\Notification\INotification;
use OCP\Notification\IncompleteParsedNotificationException;
use OCP\Notification\InvalidValueException;
use OCP\Notification\UnknownNotificationException;
use Psr\Log\LoggerInterface;

/** Translates only Timesheet release notifications and handles the native dismissal action. */
class UpdateNotesNotifier implements IDismissableNotifier {
	public function __construct(private UpdateNotesService $notesService, private IFactory $l10nFactory, private LoggerInterface $logger) {
	}

	public function getID(): string {
		return 'timesheet';
	}

	public function getName(): string {
		return (string)$this->l10nFactory->get('timesheet')->t('Timesheet');
	}

	public function prepare(INotification $notification, string $languageCode): INotification {
		$this->requireOwnNotification($notification);
		$version = $notification->getObjectId();
		try {
			$translator = $this->l10nFactory->get('timesheet', $languageCode);
			$releases = $this->notesService->notificationReleases($notification->getUser(), $version, $translator);
		} catch (\Throwable $loadError) {
			// The native bell skips this note while keeping unrelated notifications usable.
			$this->logger->warning('An update notification could not be prepared.', ['userId' => $notification->getUser(), 'exception' => $loadError]);
			throw new IncompleteParsedNotificationException();
		}
		if ($releases === []) {
			throw new AlreadyProcessedException();
		}
		$link = $this->notesService->appLink();
		$notification
			->setParsedSubject(str_replace('{version}', $version, (string)$translator->t('Timesheet updated to {version}')))
			->setIcon($this->notesService->icon())
			->setLink($link);
		try {
			// A native WEB action follows the history link without issuing an API request.
			return $notification->addParsedAction($notification->createAction()
				->setParsedLabel((string)$translator->t('View changes'))
				->setLink($link, IAction::TYPE_WEB)
				->setPrimary(true));
		} catch (InvalidValueException) {
			// Nextcloud accepts longer URLs on the notification itself than on an action.
			return $notification->setParsedMessage((string)$translator->t('Open the update notes.'));
		}
	}

	public function dismissNotification(INotification $notification): void {
		$this->requireOwnNotification($notification);
		$this->notesService->dismiss($notification->getUser(), $notification->getObjectId());
	}

	private function requireOwnNotification(INotification $notification): void {
		if ($notification->getApp() !== 'timesheet' || $notification->getObjectType() !== UpdateNotesService::OBJECT_TYPE
			|| $notification->getSubject() !== UpdateNotesService::SUBJECT) {
			throw new UnknownNotificationException();
		}
	}
}
