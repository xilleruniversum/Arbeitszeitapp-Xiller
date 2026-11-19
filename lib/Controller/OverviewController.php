<?php

namespace OCA\Timesheet\Controller;

use OCP\AppFramework\Controller;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\DataResponse;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\Services\IAppConfig;
use OCP\IRequest;
use OCP\IUserSession;
use OCA\Timesheet\Db\EntryMapper;
use OCA\Timesheet\Db\UserConfigMapper;
use OCA\Timesheet\Db\EmploymentStatusStore;
use OCA\Timesheet\Service\HrService;
use OCA\Timesheet\Service\HolidayService;
use OCA\Timesheet\Service\MonthlyBalanceService;

class OverviewController extends Controller {

	public function __construct(
		string $appName,
		IRequest $request,
		private IAppConfig $appConfig,
		private EntryMapper $entryMapper,
		private UserConfigMapper $userConfigMapper,
		private IUserSession $userSession,
		private HrService $hrService,
		private HolidayService $holidayService,
		private MonthlyBalanceService $monthlyBalanceService,
		private EmploymentStatusStore $employmentStatusStore,
	) {
		parent::__construct($appName, $request);
	}

	#[NoAdminRequired]
	public function users(): DataResponse {
		if (!$this->hrService->isHr()) {
			return new DataResponse([], 403);
		}

		return new DataResponse($this->hrService->getAccessibleUsers());
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function getOvertimeSummary(): JSONResponse {
		// Get current user
		$currentUser = $this->userSession->getUser();
		if (!$currentUser) {
			return new JSONResponse(['error' => 'Unauthorized'], 401);
		}

		// Get requested userId or fallback to current user
		$userId = (string)($this->request->getParam('user') ?? $currentUser->getUID());
		if ($userId === '') {
			$userId = $currentUser->getUID();
		}

		// Check access rights
		if ($userId !== $currentUser->getUID() && !$this->hrService->canAccessUser($userId)) {
			return new JSONResponse(['error' => 'Forbidden'], 403);
		}

		$summary = $this->monthlyBalanceService->calculateCurrentBalance($userId);

		return new JSONResponse([
			'from' => $summary['from'],
			'to'   => $summary['to'],
			'totalMinutes' => $summary['totalMinutes'],
			'totalWorkdays' => $summary['totalWorkdays'],
			'targetMinutes' => $summary['targetMinutes'],
			'dailyMin' => $summary['dailyMin'],
			'openingBalanceMinutes' => $summary['openingBalanceMinutes'],
			'overtimeMinutes' => $summary['overtimeMinutes'],
			'source' => $summary['source'],
			'lastSnapshot' => $summary['lastSnapshot'],
		]);
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function getHrUserListData(): DataResponse {
		if (!$this->hrService->isHr()) {
			return new DataResponse([], 403);
		}

		try {
			$employees = $this->hrService->getEmployeesForOverview();
			$employmentStatuses = $this->employmentStatusStore->getStatusesForUsers(array_column($employees, 'id'));
		} catch (\Throwable $loadError) {
			return new DataResponse(['message' => 'Loading employment status failed'], 500);
		}

		$userSummaries = [];

		foreach ($employees as $user) {
			$userId = $user['id'];

			$summary = $this->monthlyBalanceService->calculateCurrentBalance($userId);
			$employmentStatus = $employmentStatuses[$userId];
			$userSummaries[] = [
				'id' => $userId,
				'name' => $user['name'] ?? $userId,
				'dailyMin' => (int)$summary['dailyMin'],
				'overtimeMinutes' => (int)$summary['overtimeMinutes'],
				'totalMinutes' => $summary['currentMonthActualMinutes'],
				'lastEntryDate' => $summary['lastEntryDate'] ?? null,
				'balanceSource' => $summary['source'] ?? 'entries',
				'lastSnapshot' => $summary['lastSnapshot'] ?? null,
				...$employmentStatus->toPublicArray(),
				'isActive' => $user['isActive'],
				'missingEntryReferenceDate' => $employmentStatus->getMissingEntryReferenceDate($summary['lastEntryDate'] ?? null),
			];
		}

		return new DataResponse($userSummaries);
	}
}
