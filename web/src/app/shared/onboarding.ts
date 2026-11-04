import { Component, computed, effect, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../core/api.service';
import { LineService } from '../core/line.service';
import { OnboardingService } from '../core/onboarding.service';
import { SettingsService } from '../core/settings.service';
import { ToastService } from '../core/toast.service';
import { Icon } from './icon';

type SlideKey = 'welcome' | 'board' | 'control' | 'try';

interface Slide {
  key: SlideKey;
  title: string;
  body: string;
}

const SLIDES: Slide[] = [
  {
    key: 'welcome',
    title: 'Welcome to Orchestrator',
    body: 'Orchestrator runs AI workflows step by step and lets you step in at any moment. This tour takes about 30 seconds.',
  },
  {
    key: 'board',
    title: 'Read the board',
    body: 'The strip across the top of every screen shows each workflow. Only what needs you lights up.',
  },
  {
    key: 'control',
    title: 'Step in anytime',
    body: 'Approve or reject steps that wait for a person, retry or skip a step, or pause everything with one button.',
  },
  {
    key: 'try',
    title: 'Try it now',
    body: 'Run the AI Content Pipeline. Watch its steps light up as workers pick them up, then approve the editorial step when it asks for you.',
  },
];

/** The workflow the last slide starts: the seeded demo with an approval gate. */
const DEMO_WORKFLOW = 'AI Content Pipeline';

/** First-visit tour: four short slides, skippable at any point, ending on a real run. */
@Component({
  selector: 'app-onboarding',
  imports: [FormsModule, Icon],
  template: `
    <dialog #dialog class="dialog tour" aria-labelledby="tour-title" aria-describedby="tour-body" (close)="closed()" (keydown)="key($event)">
      <button type="button" class="tour-close" (click)="dismiss()" aria-label="Close tour"><app-icon name="close" /></button>
      @for (i of [index()]; track i) {
        <div class="tour-slide">
          <div class="tour-visual" aria-hidden="true">
            @switch (slide().key) {
              @case ('welcome') {
                <div class="mini-board">
                  <div class="mini-cell lit-run"><i></i><span><b>AI Content Pipeline</b><small>2 running</small></span></div>
                  <div class="mini-cell lit-wait"><i></i><span><b>Support Ticket Triage</b><small>1 awaiting approval</small></span></div>
                  <div class="mini-cell"><i></i><span><b>Website Health Check</b><small>Idle</small></span></div>
                </div>
              }
              @case ('board') {
                <ul class="mini-legend">
                  <li><i class="lamp s-running"></i><b>Running</b><span>being worked on</span></li>
                  <li><i class="lamp s-waiting_approval"></i><b>Needs you</b><span>waiting for your approval</span></li>
                  <li><i class="lamp s-failed"></i><b>Failed</b><span>something went wrong</span></li>
                  <li><i class="lamp s-queued"></i><b>Queued</b><span>waiting for a free worker</span></li>
                  <li><i class="lamp s-succeeded"></i><b>Finished</b><span>done, so it goes quiet</span></li>
                </ul>
              }
              @case ('control') {
                <div class="mini-gate">
                  <div class="mini-gate-text"><b>Editorial approval</b><span>Review the draft before publishing</span></div>
                  <div class="mini-gate-actions">
                    <span class="mini-btn approve"><app-icon name="approve" />Approve</span>
                    <span class="mini-btn reject"><app-icon name="cancel" />Reject</span>
                  </div>
                </div>
                <div class="mini-overrides">
                  <span class="mini-btn"><app-icon name="retry" />Retry step</span>
                  <span class="mini-btn"><app-icon name="skip" />Skip step</span>
                  <span class="mini-btn"><app-icon name="pause" />Pause all</span>
                </div>
              }
              @case ('try') {
                <div class="mini-run">
                  <ol class="mini-stations">
                    @for (s of demoSteps; track s) {
                      <li><i></i><span>{{ s }}</span></li>
                    }
                  </ol>
                </div>
              }
            }
          </div>

          <div class="tour-text">
            <h2 id="tour-title">{{ slide().title }}</h2>
            <p id="tour-body">{{ slide().body }}</p>
            @if (slide().key === 'control') {
              <label class="tour-name">Your name <small>Shown in the audit log next to everything you approve, retry or pause.</small>
                <input name="tour-name" [(ngModel)]="name" placeholder="operator" autocomplete="name" />
              </label>
            }
            @if (slide().key === 'try' && mock()) {
              <p class="tour-note"><app-icon name="info" />Claude runs in mock mode here, so the demo is free and nothing leaves this machine.</p>
            }
          </div>
        </div>
      }

      <footer class="tour-foot">
        <div class="tour-progress">
          <ol class="tour-steps" aria-label="Tour steps">
            @for (s of slides; track s.key; let n = $index) {
              <li>
                <button type="button" [class]="'tour-step ' + (n === index() ? 'current' : n < index() ? 'done' : '')"
                        [attr.aria-current]="n === index() ? 'step' : null" (click)="go(n)">
                  <span class="sr-only">Step {{ n + 1 }}: {{ s.title }}</span>
                </button>
              </li>
            }
          </ol>
          <span class="tour-count">{{ index() + 1 }} of {{ slides.length }}</span>
        </div>
        <div class="tour-actions">
          @if (last()) {
            <button type="button" class="btn ghost" (click)="dismiss()">Explore on my own</button>
          } @else {
            <button type="button" class="btn ghost" (click)="dismiss()">Skip tour</button>
          }
          @if (index() > 0) {
            <button type="button" class="btn" (click)="go(index() - 1)"><app-icon name="back" />Back</button>
          }
          @if (last()) {
            <button #primary type="button" class="btn primary" autofocus [disabled]="starting()" (click)="runDemo()">
              <app-icon name="play" />{{ starting() ? 'Starting…' : 'Run the demo workflow' }}
            </button>
          } @else {
            <button #primary type="button" class="btn primary" autofocus (click)="go(index() + 1)">Next<app-icon name="forward" /></button>
          }
        </div>
      </footer>
      <p class="sr-only" aria-live="polite">Step {{ index() + 1 }} of {{ slides.length }}: {{ slide().title }}</p>
    </dialog>
  `,
})
export class OnboardingTour {
  /** True when LLM steps run in mock mode (no API key), so the last slide can say the demo is free. */
  readonly mock = input(false);

  protected readonly tour = inject(OnboardingService);
  private readonly settings = inject(SettingsService);
  private readonly line = inject(LineService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly primary = viewChild<ElementRef<HTMLButtonElement>>('primary');

  protected readonly slides = SLIDES;
  protected readonly demoSteps = ['Research', 'Outline', 'Draft', 'Approval', 'Package'];
  protected readonly index = signal(0);
  protected readonly slide = computed(() => SLIDES[this.index()]);
  protected readonly last = computed(() => this.index() === SLIDES.length - 1);
  protected readonly starting = signal(false);
  protected name = '';

  constructor() {
    effect(() => {
      const el = this.dialog().nativeElement;
      if (this.tour.open() && !el.open) {
        this.index.set(0);
        this.name = this.settings.actor() === 'operator' ? '' : this.settings.actor();
        el.showModal();
      } else if (!this.tour.open() && el.open) {
        el.close();
      }
    });
    // Keep keyboard focus on the main action as slides change.
    effect(() => {
      this.index();
      const button = this.primary()?.nativeElement;
      if (this.tour.open() && button && !(document.activeElement instanceof HTMLInputElement)) button.focus();
    });
  }

  protected go(n: number): void {
    this.index.set(Math.max(0, Math.min(SLIDES.length - 1, n)));
  }

  protected key(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'ArrowRight') this.go(this.index() + 1);
    else if (e.key === 'ArrowLeft') this.go(this.index() - 1);
    else return;
    e.preventDefault();
  }

  protected dismiss(): void {
    this.dialog().nativeElement.close();
  }

  /** Every way out (buttons, Esc) ends here through the dialog's close event. */
  protected closed(): void {
    const name = this.name.trim();
    if (name && name !== this.settings.actor()) this.settings.save(name, this.settings.token());
    this.tour.close();
  }

  protected runDemo(): void {
    const workflow = this.line.workflows().find((w) => w.name === DEMO_WORKFLOW);
    if (!workflow) {
      this.dismiss();
      this.router.navigate(['/workflows']);
      return;
    }
    this.starting.set(true);
    this.api.startRun(workflow.id, workflow.definition.exampleInput ?? {}).subscribe({
      next: (run) => {
        this.starting.set(false);
        this.dismiss();
        this.router.navigate(['/runs', run.id]);
      },
      error: (e) => {
        this.starting.set(false);
        this.toast.error(e);
      },
    });
  }
}
