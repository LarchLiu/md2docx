// Progress Indicator
// Handles showing/hiding and updating progress indicators

/**
 * Update progress circle based on completed vs total tasks
 * @param completed - Number of completed tasks
 * @param total - Total number of tasks
 */
export function updateProgress(completed: number, total: number): void {
  const progressCircle = document.querySelector('.progress-circle-progress') as SVGCircleElement | null;
  if (!progressCircle) return;

  // Calculate progress percentage
  const progress = completed / total;
  const circumference = 43.98; // 2 * PI * 7 (radius)

  // Calculate stroke-dashoffset (starts at full circle, decreases as progress increases)
  const offset = circumference * (1 - progress);

  progressCircle.style.strokeDashoffset = String(offset);
}

/**
 * Show processing indicator in TOC header
 */
export function showProcessingIndicator(): void {
  const indicator = document.getElementById('processing-indicator');

  if (indicator) {
    indicator.classList.remove('hidden');
  }
}

/**
 * Hide processing indicator in TOC header
 */
export function hideProcessingIndicator(): void {
  const indicator = document.getElementById('processing-indicator');
  if (indicator) {
    indicator.classList.add('hidden');
  }
}
