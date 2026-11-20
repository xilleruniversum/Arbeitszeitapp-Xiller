<?php

declare(strict_types=1);

// Run only against a disposable Nextcloud instance with a local test mailbox.
if (PHP_SAPI !== 'cli' || getenv('UPDATE_TEST_ENVIRONMENT') !== '1') {
	fwrite(STDERR, "The isolated update-test environment is required.\n");
	exit(1);
}
$configuredDatabase = (static function (): string {
	$CONFIG = [];
	require '/var/www/html/config/config.php';
	return (string)($CONFIG['dbname'] ?? '');
})();
if ($configuredDatabase !== 'timesheet_updates_test') {
	throw new RuntimeException('Refusing to run against a different database.');
}
define('OC_CONSOLE', true);
require '/var/www/html/lib/base.php';

use OCA\Timesheet\AppInfo\Application;
use OCA\Timesheet\Db\UpdateNotesStore;
use OCA\Timesheet\Service\UpdateNotesService;

$config = \OCP\Server::get(\OCP\IConfig::class);
$database = \OCP\Server::get(\OCP\IDBConnection::class);
if ($database->executeQuery('SELECT DATABASE()')->fetchOne() !== 'timesheet_updates_test'
	|| $config->getSystemValueString('mail_smtphost') !== 'mailpit') {
	throw new RuntimeException('The isolated database and Mailpit transport are required.');
}
$password = getenv('UPDATE_TEST_PASSWORD');
if (!$password) {
	throw new RuntimeException('A synthetic test password is required.');
}
$users = \OCP\Server::get(\OCP\IUserManager::class);
$groups = \OCP\Server::get(\OCP\IGroupManager::class);
$session = \OCP\Server::get(\OCP\IUserSession::class);
$translations = \OCP\Server::get(\OCP\L10N\IFactory::class);
$manager = \OCP\Server::get(\OCP\Notification\IManager::class);
// Console bootstrap registers notifiers but does not boot the bell's storage app.
\OCP\Server::get(\OC\AppFramework\Bootstrap\Coordinator::class)->bootApp('notifications');
$handler = \OCP\Server::get(\OCA\Notifications\Handler::class);
$app = new Application();
$container = $app->getContainer();
$appConfig = $container->get(\OCP\AppFramework\Services\IAppConfig::class);
$service = $container->get(UpdateNotesService::class);
$store = $container->get(UpdateNotesStore::class);
$accounts = [];

foreach (['employee', 'hr', 'hr-admin', 'other', 'promoted', 'disabled', 'unreleased'] as $suffix) {
	$userId = 'update-' . $suffix;
	$user = $users->get($userId) ?? $users->createUser($userId, $password);
	$user->setDisplayName('Update test ' . $suffix);
	$user->setEMailAddress($userId . '@example.test');
	$user->setEnabled($suffix !== 'disabled');
	// Clear only this runner's synthetic notes and preference state.
	$query = $database->getQueryBuilder();
	$query->delete('notifications')->where($query->expr()->eq('user', $query->createNamedParameter($userId)))
		->andWhere($query->expr()->eq('app', $query->createNamedParameter('timesheet')))->executeStatement();
	$config->deleteUserValue($userId, 'timesheet', 'update_notes_state');
	$config->setUserValue($userId, 'core', 'lang', $suffix === 'hr' ? 'en' : 'de');
	$accounts[$suffix] = $user;
}
unset($password);
$adminGroup = $groups->get('admin');
$adminGroup->addUser($accounts['hr-admin']);
$adminGroup->removeUser($accounts['promoted']);
$accounts['admin'] = $users->get('update-admin');
foreach (['update-staff' => ['employee','other','promoted'], 'update-hr' => ['hr','hr-admin']] as $groupId => $suffixes) {
	$group = $groups->get($groupId) ?? $groups->createGroup($groupId);
	foreach ($suffixes as $suffix) {
		$group->addUser($accounts[$suffix]);
	}
}
$appConfig->setAppValueString('hr_access_rules', json_encode([
	['id'=>'update-rule','hrGroups'=>['update-hr'],'userGroups'=>['update-staff'],'priority'=>1],
], JSON_THROW_ON_ERROR));
$session->setUser($accounts['employee']);

$checks = 0;
function verifyUpdate(mixed $actual, mixed $expected, string $description): void {
	global $checks;
	$checks++;
	if ($actual !== $expected) {
		throw new RuntimeException($description . ': ' . json_encode(['actual'=>$actual,'expected'=>$expected]));
	}
}
$notesFor = static function (string $userId) use ($database): array {
	$query = $database->getQueryBuilder();
	return $query->select('*')->from('notifications')
		->where($query->expr()->eq('user', $query->createNamedParameter($userId)))
		->andWhere($query->expr()->eq('app', $query->createNamedParameter('timesheet')))
		->orderBy('notification_id')->executeQuery()->fetchAll();
};
$entriesBefore = $database->getQueryBuilder()->select('*')->from('ts_entries')->orderBy('id')->executeQuery()->fetchAll();
$balancesBefore = $database->getQueryBuilder()->select('*')->from('ts_monthly_balances')->orderBy('id')->executeQuery()->fetchAll();
$de = $translations->get('timesheet','de');
$en = $translations->get('timesheet','en');
verifyUpdate($appConfig->getAppValueString('installed_version'), '1.3.0', 'Successfully installed release is used');
verifyUpdate(in_array('timesheet', array_map(static fn($notifier): string => $notifier->getID(), $manager->getNotifiers()), true), true, 'Native notifier is registered through app bootstrap');
$createdId='update-created-'.bin2hex(random_bytes(3));
$users->createUser($createdId,getenv('UPDATE_TEST_PASSWORD'));
verifyUpdate($store->isNewAccount($createdId),true,'Native account creation marks only the new account for current-release onboarding');

$first = $service->open('update-employee','automatic',$de);
verifyUpdate($first['shouldShow'],false,'First employee visit does not open version history');
verifyUpdate($first['releases'],[],'A first visit returns no release notes to display');
verifyUpdate(count($notesFor('update-employee')),1,'First visit creates one native bell notification');
$service->open('update-employee','automatic',$de);
verifyUpdate(count($notesFor('update-employee')),1,'Repeated visits do not duplicate the native notification');
verifyUpdate(array_column($service->open('update-employee','manual',$de)['releases'],'version'),['1.3.0'],'Explicit opening returns the available version history');
$service->markShown('update-employee','1.3.0');
verifyUpdate($service->open('update-employee','automatic',$de)['shouldShow'],false,'Version history remains closed on ordinary app visits');
verifyUpdate(count($notesFor('update-employee')),1,'Opening the history leaves the bell entry available');
verifyUpdate($store->read('update-employee')['dismissedVersion'],null,'Only explicit native dismissal updates the dismissal state');
verifyUpdate($service->open('update-employee','manual',$de)['shouldShow'],true,'The bell link reopens version history');
$record=$notesFor('update-employee')[0];
$notification=$handler->getById((int)$record['notification_id'],'update-employee');
$prepared=$manager->prepare($notification,'de');
verifyUpdate(str_contains($prepared->getParsedSubject(),'Arbeitszeitnachweis'),true,'Native German subject uses the account language');
verifyUpdate(str_contains($prepared->getParsedSubject(),'1.3.0'),true,'Native subject substitutes the release version');
verifyUpdate($prepared->getParsedMessage(),'','Native notification leaves the full changes in the version history');
verifyUpdate(str_contains($prepared->getLink(),'update-notes=1'),true,'Native link opens version history');
$actions=$prepared->getParsedActions();
verifyUpdate(count($actions),1,'The native notification has one action');
verifyUpdate($actions[0]->getParsedLabel(),'Änderungen ansehen','The native action uses the account language');
verifyUpdate($actions[0]->getRequestType(),\OCP\Notification\IAction::TYPE_WEB,'The native action navigates to the history');
verifyUpdate($actions[0]->getLink(),$prepared->getLink(),'The native action opens the same history URL');
verifyUpdate($handler->deleteById((int)$record['notification_id'],'update-employee'),true,'The actual native X path deletes the note');
verifyUpdate($store->read('update-employee')['dismissedVersion'],'1.3.0','The native X persists dismissal for this account');
verifyUpdate($service->open('update-employee','automatic',$de)['shouldShow'],false,'A dismissed release does not reopen');
verifyUpdate(count($notesFor('update-employee')),0,'A dismissed release is not republished');
verifyUpdate(array_column($service->open('update-employee','manual',$de)['releases'],'version'),['1.3.0'],'Dismissed release notes remain in the history');
verifyUpdate(count($notesFor('update-employee')),0,'Manually reading dismissed notes does not resurrect the bell');

$hr=$service->open('update-hr','automatic',$en);
verifyUpdate($hr['shouldShow'],false,'HR receives release notes only on explicit opening');
$hrRecord=$notesFor('update-hr')[0];
verifyUpdate(str_contains($manager->prepare($handler->getById((int)$hrRecord['notification_id'],'update-hr'),'en')->getParsedSubject(),'updated'),true,'English notification uses its own language');
$service->open('update-other','automatic',$de);
verifyUpdate($store->read('update-other')['dismissedVersion'],null,'Separate accounts retain independent unread state');
verifyUpdate($handler->deleteByUser('update-hr'),true,'The actual native clear-all path removes HR notes');
verifyUpdate($store->read('update-hr')['dismissedVersion'],'1.3.0','Native clear-all persists dismissal');
verifyUpdate(count($notesFor('update-other')),1,'Clearing one account leaves other accounts intact');

foreach (['admin','hr-admin'] as $suffix) {
	$session->setUser($accounts[$suffix]);
	$controller=$container->get(\OCA\Timesheet\Controller\UpdateNotesController::class);
	verifyUpdate($controller->load()->getStatus(),200,'Administrator can load notes: '.$suffix);
	verifyUpdate(count($notesFor($accounts[$suffix]->getUID())),1,'Administrator receives a native note: '.$suffix);
	verifyUpdate($controller->shown('1.3.0')->getStatus(),200,'Administrator can mark notes as shown: '.$suffix);
	verifyUpdate($controller->load()->getData()['shouldShow'],false,'Administrator app visits leave version history closed: '.$suffix);
	verifyUpdate($controller->load('manual')->getData()['shouldShow'],true,'Administrator can reopen the current release: '.$suffix);
	verifyUpdate(count($notesFor($accounts[$suffix]->getUID())),1,'Opening the history leaves the administrator bell note available: '.$suffix);
}
$session->setUser($accounts['disabled']);
$controller=$container->get(\OCA\Timesheet\Controller\UpdateNotesController::class);
verifyUpdate($controller->load()->getStatus(),403,'Disabled account cannot load notes');
verifyUpdate($controller->shown('1.3.0')->getStatus(),403,'Disabled account cannot mark notes');
verifyUpdate(count($notesFor($accounts['disabled']->getUID())),0,'Disabled account has no native note');

$service->open('update-promoted','automatic',$de);
$promoted=$notesFor('update-promoted')[0];
$adminGroup->addUser($accounts['promoted']);
$preparedPromoted=$manager->prepare($handler->getById((int)$promoted['notification_id'],'update-promoted'),'de');
verifyUpdate($preparedPromoted->getParsedSubject() !== '',true,'A newly promoted administrator retains the native note');
verifyUpdate(count($notesFor('update-promoted')),1,'Native preparation preserves the administrator note');
verifyUpdate($store->read('update-promoted')['dismissedVersion'],null,'Role promotion does not acknowledge unread changes');
verifyUpdate($service->open('update-promoted','manual',$de)['shouldShow'],true,'Role promotion preserves access to version history');
$adminGroup->removeUser($accounts['promoted']);

$installedVersion=$appConfig->getAppValueString('installed_version');
try {
	$appConfig->setAppValueString('installed_version','1.2.0');
	$missing=$service->open('update-unreleased','automatic',$de);
	verifyUpdate($missing['shouldShow'],false,'An installed version without bundled notes opens no history panel on arrival');
	verifyUpdate(count($notesFor('update-unreleased')),0,'Missing release notes create no bell entry');
} finally {
	$appConfig->setAppValueString('installed_version',$installedVersion);
}
verifyUpdate($database->getQueryBuilder()->select('*')->from('ts_entries')->orderBy('id')->executeQuery()->fetchAll(),$entriesBefore,'Update notes leave time entries unchanged');
verifyUpdate($database->getQueryBuilder()->select('*')->from('ts_monthly_balances')->orderBy('id')->executeQuery()->fetchAll(),$balancesBefore,'Update notes leave balance records unchanged');

// Fresh, synthetic fixtures remain available for the isolated HTTP and visual checks.
foreach (['employee','hr'] as $suffix) {
	$handler->deleteByUser('update-'.$suffix);
	$config->deleteUserValue('update-'.$suffix,'timesheet','update_notes_state');
}
echo json_encode(['updateChecks'=>$checks,'result'=>'passed'],JSON_UNESCAPED_SLASHES)."\n";
