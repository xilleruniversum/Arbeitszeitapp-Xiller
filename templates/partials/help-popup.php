<?php
$renderHelpPopup = static function (string $id, string $label, array $paragraphs): void {
	?>
	<button type="button" class="hr-help-button" data-hr-help aria-label="<?php p($label); ?>"
		aria-expanded="false" aria-controls="<?php p($id); ?>" aria-describedby="<?php p($id); ?>"></button>
	<span id="<?php p($id); ?>" class="hr-help-popup" popover="manual" role="tooltip" hidden>
		<?php foreach ($paragraphs as $paragraph): ?>
			<span><?php p($paragraph); ?></span>
		<?php endforeach; ?>
	</span>
	<?php
};
