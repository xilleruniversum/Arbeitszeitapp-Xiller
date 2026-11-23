<?php

declare(strict_types=1);

namespace OCA\Timesheet\Service;

use OCP\IGroupManager;

/** Resolves employment status from assigned groups independently of which HR account is viewing it. */
class EmployeeGroupRules {
	public const LEGACY_ACTIVE_GROUP_ID = 'Zeitnachweis';
	public const LEGACY_ARCHIVE_GROUP_ID = 'Zeitnachweis-Archiv';

	private array $activeGroups = [];
	private array $inactiveGroups = [];
	private array $legacyGroups = [];
	private bool $hasExplicitRules = false;

	public function __construct(array $rules, private IGroupManager $groupManager) {
		foreach ($rules as $rule) {
			if (!is_array($rule) || !is_scalar($rule['id'] ?? null) || trim((string)$rule['id']) === '') {
				continue;
			}

			if (array_key_exists('inactiveUserGroups', $rule)) {
				$this->hasExplicitRules = true;
				$groups = self::forEditor($rule);
				$this->activeGroups = array_merge($this->activeGroups, $groups['userGroups']);
				$this->inactiveGroups = array_merge($this->inactiveGroups, $groups['inactiveUserGroups']);
			} else {
				$this->legacyGroups = array_merge($this->legacyGroups, self::assignedGroups($rule));
			}
		}

		$this->activeGroups = array_unique($this->activeGroups);
		$this->inactiveGroups = array_unique($this->inactiveGroups);
		$this->legacyGroups = array_unique($this->legacyGroups);
	}

	/** @return array{userGroups:string[],inactiveUserGroups:string[]} */
	public static function forEditor(array $rule): array {
		$active = self::identifiers($rule['userGroups'] ?? $rule['user_groups'] ?? []);
		if (array_key_exists('inactiveUserGroups', $rule)) {
			return ['userGroups' => $active, 'inactiveUserGroups' => self::identifiers($rule['inactiveUserGroups'])];
		}

		$archive = self::LEGACY_ARCHIVE_GROUP_ID;
		return [
			'userGroups' => array_values(array_filter($active, static fn (string $id): bool => $id !== $archive)),
			'inactiveUserGroups' => in_array($archive, $active, true) ? [$archive] : [],
		];
	}

	/** @return string[] */
	public static function assignedGroups(array $rule): array {
		$assigned = self::identifiers($rule['userGroups'] ?? $rule['user_groups'] ?? []);
		return array_values(array_unique(array_merge($assigned, self::identifiers($rule['inactiveUserGroups'] ?? []))));
	}

	public function affectsActivity(string $groupId): bool {
		if (!$this->hasExplicitRules) {
			return $groupId === self::LEGACY_ACTIVE_GROUP_ID;
		}

		return in_array($groupId, $this->activeGroups, true)
			|| in_array($groupId, $this->legacyGroups, true)
			|| ($this->legacyGroups !== [] && $groupId === self::LEGACY_ACTIVE_GROUP_ID);
	}

	/** Null indicates that the account belongs to neither status. */
	public function status(string $userId, ?string $changedGroup = null, bool $added = false): ?bool {
		$isMember = fn (string $groupId): bool => $groupId === $changedGroup
			? $added : $this->groupManager->isInGroup($userId, $groupId);

		if ($this->hasMember($this->activeGroups, $isMember)) {
			return true;
		}

		// Keep the previous classification for legacy rules. When rules have been converted,
		// the old defaults only apply to accounts still covered by a legacy assignment.
		$usesLegacyStatus = !$this->hasExplicitRules || $this->hasMember($this->legacyGroups, $isMember);
		if ($usesLegacyStatus && $isMember(self::LEGACY_ACTIVE_GROUP_ID)) {
			return true;
		}

		if ($this->hasMember($this->inactiveGroups, $isMember)
			|| ($usesLegacyStatus && $isMember(self::LEGACY_ARCHIVE_GROUP_ID))) {
			return false;
		}

		return null;
	}

	private function hasMember(array $groups, callable $isMember): bool {
		foreach ($groups as $groupId) {
			if ($isMember($groupId)) {
				return true;
			}
		}

		return false;
	}

	private static function identifiers(mixed $values): array {
		if (!is_array($values)) {
			return [];
		}

		return array_values(array_unique(array_filter(array_map(
			static fn (mixed $value): string => is_string($value) ? trim($value) : '', $values
		), static fn (string $value): bool => $value !== '')));
	}
}
