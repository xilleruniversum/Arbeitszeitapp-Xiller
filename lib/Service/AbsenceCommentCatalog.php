<?php

declare(strict_types=1);

namespace OCA\Timesheet\Service;

use RuntimeException;

/** Supplies localized labels for existing absence comment types. */
class AbsenceCommentCatalog {

	/** @var array<string,array{vacation:string,sick:string,appointment:string}> */
	private array $termsByLanguage = [];

	public function __construct() {
		$catalogFile = __DIR__ . '/absence-comment-terms.json';
		$contents = file_get_contents($catalogFile);
		if ($contents === false) {
			throw new RuntimeException('The absence comment catalog could not be read.');
		}
		$catalog = json_decode($contents, true, 512, JSON_THROW_ON_ERROR);
		if (!is_array($catalog) || !isset($catalog['en'], $catalog['de'])) {
			throw new RuntimeException('The absence comment catalog must include English and German terms.');
		}

		foreach ($catalog as $language => $terms) {
			if (!is_string($language) || !is_array($terms)
				|| !$this->isValidTerm($terms['vacation'] ?? null)
				|| !$this->isValidTerm($terms['sick'] ?? null)
				|| !$this->isValidTerm($terms['appointment'] ?? null)) {
				throw new RuntimeException('The absence comment catalog contains invalid terms.');
			}
			$language = $this->normalizeLanguage($language);
			$this->termsByLanguage[$language] = [
				'vacation' => $terms['vacation'],
				'sick' => $terms['sick'],
				'appointment' => $terms['appointment'],
			];
		}
	}

	/** @return array{vacation:string,sick:string,appointment:string} */
	public function getTerms(string $language): array {
		$language = $this->normalizeLanguage($language);
		$baseLanguage = explode('_', $language, 2)[0];
		if (isset($this->termsByLanguage[$language])) {
			return $this->termsByLanguage[$language];
		}
		if (isset($this->termsByLanguage[$baseLanguage])) {
			return $this->termsByLanguage[$baseLanguage];
		}
		// Some Nextcloud languages are offered only with a region, such as et_EE.
		foreach ($this->termsByLanguage as $knownLanguage => $terms) {
			if (explode('_', $knownLanguage, 2)[0] === $baseLanguage) {
				return $terms;
			}
		}
		return $this->termsByLanguage['en'];
	}

	private function isValidTerm(mixed $term): bool {
		return is_string($term) && preg_match('/[^\s\p{Z}\x{FEFF}]/u', $term) === 1;
	}

	private function normalizeLanguage(string $language): string {
		return strtolower(str_replace('-', '_', trim($language)));
	}
}
