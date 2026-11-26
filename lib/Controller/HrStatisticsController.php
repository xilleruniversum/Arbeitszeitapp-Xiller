<?php

declare(strict_types=1);

namespace OCA\Timesheet\Controller;

use InvalidArgumentException;
use OC\ForbiddenException;
use OCA\Timesheet\Service\HrStatisticsService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\DataResponse;
use OCP\IRequest;

class HrStatisticsController extends Controller {
	public function __construct(string $appName, IRequest $request, private HrStatisticsService $statistics) {
		parent::__construct($appName, $request);
	}

	#[NoAdminRequired]
	public function index(): DataResponse {
		try {
			return new DataResponse($this->statistics->getStatistics($this->request->getParams()));
		} catch (ForbiddenException) {
			return new DataResponse(['error' => 'Forbidden'], 403);
		} catch (InvalidArgumentException) {
			return new DataResponse(['error' => 'Invalid statistics filters'], 400);
		}
	}
}
