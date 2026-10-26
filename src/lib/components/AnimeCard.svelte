<script lang="ts">
  import { enhance, type SubmitFunction } from '$app/forms';
  import { onDestroy, onMount, tick } from 'svelte';

  import {
    BIG_BACKLOG,
    getEpisodesToWatch,
    getWatchState,
    hasNewEpisode,
    mayHaveNewEpisode,
    type WatchState,
  } from '#lib/anime.js';
  import {
    angleBetween,
    axisAngle,
    highlightOn,
    IDENTITY,
    inverse,
    multiply,
    tiltOf,
    toAxisAngle,
    toCss,
    type Rotation,
  } from '#lib/card-rotation.js';
  import { clock } from '#lib/clock.js';
  import ScoreInput from '#lib/components/ScoreInput.svelte';
  import { formatAirDate, formatAirsIn } from '#lib/countdown.js';
  import { flippedCard } from '#lib/flipped-card.svelte.js';
  import { nyaaSearchUrl, nyaaSite } from '#lib/nyaa.js';
  import { countsBeforeSave } from '#lib/saved-counts.js';
  import {
    DEFAULT_SCORE_FORMAT,
    describeScore,
    formatMeanScore,
    formatScore,
    scoreChoices,
    type ScoreFormat,
  } from '#lib/score.js';
  import type { Anime } from '#lib/types/anime.js';
  import type { DownloadLanguage, DownloadVersion } from '#lib/types/preferences.js';

  type Props = {
    anime: Anime;
    animeLinkFn: (animeId: number) => string;
    /** Whether the signed-in user can update this anime's progress */
    canEdit?: boolean;
    /**
     * Called when an update catches the user up on this anime, or finishes it, with the anime as
     * AniList saved it; `scored` says the same update also set its score
     */
    onCaughtUp?: (
      kind: 'caught-up' | 'completed',
      anime: Anime,
      update: { scored: boolean }
    ) => void;
    /** The viewer's setting: blur covers of anime AniList marks as adult */
    blurMature?: boolean;
    /** The viewer's setting: which releases the nyaa.si search looks for */
    downloadLanguage?: DownloadLanguage;
    /** The viewer's setting: subbed, dubbed or dual-audio releases for that search */
    downloadVersion?: DownloadVersion;
    /** How the list owner scores anime on AniList, which `anime.userScore` is in */
    scoreFormat?: ScoreFormat;
    /** Where the card is in the list, counting from 0 */
    position?: number;
    /** Apply the confirmed progress before requesting fresh list data. */
    onConfirmed: (saved: Anime, status: string) => void;
    /** Called once a save is done and the list reloaded, with where the card was before */
    onSaved?: (animeId: number, positionBefore: number) => void;
    /** Glows for a moment, so the eye finds the card in its new place after a save */
    highlighted?: boolean;
  };

  let {
    anime,
    animeLinkFn,
    canEdit = false,
    onCaughtUp,
    blurMature = true,
    downloadLanguage = 'any',
    downloadVersion = 'any',
    scoreFormat = DEFAULT_SCORE_FORMAT,
    position = 0,
    onSaved,
    onConfirmed,
    highlighted = false,
  }: Props = $props();

  const coverBlurred = $derived(anime.isAdult && blurMature);

  // Countdowns use the viewer's clock and time zone, so they only appear once in the browser
  let mounted = $state(false);
  onMount(() => (mounted = true));
  /*
   * Browsers that can't register `--card-turn` (Firefox before 128) can't animate it, so there the
   * card turns by transitioning its transform instead, without following the mouse
   */
  let legacyTurn = $state(false);
  onMount(() => (legacyTurn = !('registerProperty' in CSS)));
  /*
   * A card that leaves the page, as when it scrolls out of a long list, no longer counts as the one
   * turned over, or the page would wait forever for it to be turned back before reloading. Work it
   * still had going, like a drag settling, stops there and can't claim that again
   */
  let destroyed = false;
  onDestroy(() => {
    destroyed = true;
    if (flippedCard.id === uid) flippedCard.id = null;
  });

  const countdown = $derived.by(() => {
    if (!mounted || !anime.nextEpisode) return null;
    const { number, airsAt } = anime.nextEpisode;
    const airsIn = formatAirsIn(airsAt, clock.now);
    return {
      label: `Ep ${number} ${airsIn}`,
      spoken: `Caught up. Episode ${number} airs ${airsIn}`,
      date: `Episode ${number} airs ${formatAirDate(airsAt)}`,
    };
  });

  // Both services report 0 episodes while the total isn't known yet
  const totalEpisodes = $derived(anime.numberEpisodes || null);
  const progressLabel = $derived(`${anime.currentEpisode} / ${totalEpisodes ?? '?'}`);
  // How many episodes have aired, on the card's back, unless that's all of them
  const airedNote = $derived(
    anime.numberAiredEpisodes && anime.numberAiredEpisodes !== totalEpisodes
      ? `${anime.numberAiredEpisodes.toLocaleString()} aired`
      : null
  );
  const episodesToWatch = $derived(getEpisodesToWatch(anime));
  const watchState = $derived(getWatchState(anime));
  // The next episode to watch, when it has already aired; only offered on the viewer's own list
  const nextToWatch = $derived(canEdit && episodesToWatch > 0 ? anime.currentEpisode + 1 : null);
  // Only a just-aired episode makes the badge pulse, so the pulse means something. It depends on the
  // viewer's clock, so like the countdowns it waits for the browser. Cards that can't have one
  // don't read the clock, so they aren't updated as it ticks
  const newEpisode = $derived(
    mounted && mayHaveNewEpisode(anime) && hasNewEpisode(anime, clock.now)
  );

  /*
   * Once the viewer's save lowers the count, as after +1, the number ticks into place, and
   * reaching zero splashes the caught-up badge. This card may be new, if the save moved it, so the
   * count before the save comes from outside it
   */
  let countTicks = $state(0);
  let justCaughtUp = $state(false);
  $effect(() => {
    const before = countsBeforeSave.get(anime.id);
    if (before === undefined || before === episodesToWatch) return;
    countsBeforeSave.delete(anime.id);
    if (episodesToWatch < before) countTicks += 1;
    justCaughtUp = episodesToWatch === 0;
  });

  // Badges for anime whose aired episode count isn't known
  const NO_EPISODE_INFO: Partial<Record<WatchState, { label: string; title: string }>> = {
    'next-episode-unscheduled': {
      label: 'Next episode TBA',
      title: "Still airing, but the next episode isn't scheduled yet",
    },
    hiatus: { label: 'On hiatus', title: 'Airing is paused for now' },
    'not-aired': { label: 'Not aired yet', title: "The first episode hasn't aired yet" },
    cancelled: { label: 'Cancelled', title: 'The show was cancelled before it finished' },
  };
  const noEpisodeInfo = $derived(NO_EPISODE_INFO[watchState]);

  // Widths in % of the total for the progress bar's watched and aired-but-unwatched parts
  const barParts = $derived.by(() => {
    if (!totalEpisodes) return null;
    const watched = Math.min(anime.currentEpisode, totalEpisodes);
    const aired = Math.min(watched + episodesToWatch, totalEpisodes) - watched;
    return {
      watched: (watched / totalEpisodes) * 100,
      aired: (aired / totalEpisodes) * 100,
      description:
        `${watched} of ${totalEpisodes} watched` +
        (aired > 0 ? `, ${aired} aired episode${aired === 1 ? '' : 's'} left` : ''),
    };
  });

  let saving = $state(false);

  // The episode count typed on the card's back; it resets to the saved count whenever that changes
  let watchedDraft = $derived<number | null>(anime.currentEpisode);
  const watchedChanged = $derived(watchedDraft !== null && watchedDraft !== anime.currentEpisode);

  // The score picked on the card's back, which resets to the saved score whenever that changes.
  // Star and smiley choices start on "No score"; a number field starts empty
  const savedScore = $derived(anime.userScore ?? (scoreChoices(scoreFormat) ? 0 : null));
  let scoreDraft = $derived<number | null>(savedScore);
  // 0 is no score, the same as an unscored anime
  const scoreChanged = $derived((scoreDraft ?? 0) !== (anime.userScore ?? 0));
  const entryChanged = $derived(watchedChanged || scoreChanged);
  // The fields sit in the facts list, outside their form, so they point to it by an id unique
  // to this card
  const uid = $props.id();
  const entryFormId = `entry-${uid}`;

  // Back to what's saved on AniList, dropping unsaved edits
  function revertDrafts() {
    watchedDraft = anime.currentEpisode;
    scoreDraft = savedScore;
  }
  let errorMessage = $state<string | null>(null);

  // The card flips over to show its details, instead of opening a popup
  let flipped = $state(false);
  // Set while the card spins back to its front
  let turnedBack = $state(false);
  let turnedByDrag = $state(false);
  // How long turning over, or spinning back, takes
  const TURN_MS = 760;
  let turnStartedAt = 0;
  // Long enough for the spin
  const TURN_BACK_MS = 800;
  $effect(() => {
    if (!turnedBack) return;
    // A full turn round, the card is set back to 0 degrees
    const timer = setTimeout(() => swapTurn(() => (turnedBack = false)), TURN_BACK_MS);
    return () => clearTimeout(timer);
  });

  /*
   * Moves the card to an angle a full turn from where it is, which looks the same, without a
   * transition, so it doesn't spin all the way round to get there
   */
  let swapCount = 0;
  async function swapTurn(update: () => unknown) {
    // Only the latest swap brings the transition back, so overlapping swaps can't animate
    const swap = ++swapCount;
    if (flipperElement) flipperElement.style.transition = 'none';
    await update();
    await tick();
    if (!flipperElement) return;
    // Applies the swap before the transition comes back
    flipperElement.getBoundingClientRect();
    requestAnimationFrame(() => {
      if (swap === swapCount) flipperElement?.style.removeProperty('transition');
    });
  }

  /*
   * Where the mouse is over the card, from -0.5 to 0.5 across and down, and how far it has lifted
   * toward the viewer, from 0 to 1. Each eases toward its target every frame, so the card glides
   * after the mouse rather than snapping to it. Written straight to the card's style, since they
   * change every frame
   */
  let cardElement = $state<HTMLElement>();
  const tilt = { x: 0, y: 0, lift: 0 };
  const tiltTarget = { x: 0, y: 0, lift: 0 };
  // How quickly the card catches up with the mouse: about two thirds of the way in this time
  const TILT_EASE_MS = 90;
  let tiltFrame = 0;
  let lastFrameTime = 0;

  function stepTilt(time: number) {
    // Turning, the card lies flat whatever the mouse does, so there's nothing to measure
    if (pointerAt && cardElement && !turning) {
      const rect = cardElement.getBoundingClientRect();
      const clamp = (value: number) => Math.min(0.5, Math.max(-0.5, value));
      tiltTarget.x = clamp((pointerAt.x - rect.left) / rect.width - 0.5);
      tiltTarget.y = clamp((pointerAt.y - rect.top) / rect.height - 0.5);
    }
    const ease = 1 - Math.exp(-(time - lastFrameTime) / TILT_EASE_MS);
    lastFrameTime = time;
    let moving = false;
    for (const key of ['x', 'y', 'lift'] as const) {
      // The card lies flat while it turns, then tilts toward the mouse again
      const target = turning ? 0 : tiltTarget[key];
      tilt[key] += (target - tilt[key]) * ease;
      // Close enough to be invisible ends the easing, and the work each frame with it
      if (Math.abs(target - tilt[key]) > 0.005) moving = true;
      else tilt[key] = target;
    }
    cardElement?.style.setProperty('--pointer-x', String(tilt.x));
    cardElement?.style.setProperty('--pointer-y', String(tilt.y));
    cardElement?.style.setProperty('--lift', String(tilt.lift));
    // The gloss layers only exist while the card is tilted, so idle cards don't keep them
    cardElement?.toggleAttribute('data-lit', tilt.lift !== 0 || tilt.x !== 0 || tilt.y !== 0);
    tiltFrame = moving ? requestAnimationFrame(stepTilt) : 0;
  }

  function aimTilt(target: Partial<typeof tiltTarget>) {
    Object.assign(tiltTarget, target);
    if (tiltFrame) return;
    lastFrameTime = performance.now();
    tiltFrame = requestAnimationFrame(stepTilt);
  }

  // Eases the tilt out when the card starts turning, and back in once it's done; a card that
  // isn't tilted and has no mouse over it has nothing to ease
  $effect(() => {
    void turning;
    if (pointerAt || tilt.lift !== 0 || tilt.x !== 0 || tilt.y !== 0) aimTilt(tiltTarget);
  });

  /*
   * Where the mouse last was, measured against the card once a frame rather than on every move:
   * at the start of a frame the page is already laid out, so measuring is cheap, and it stays right
   * when the card moves under a still mouse
   */
  let pointerAt: { x: number; y: number } | null = null;

  function trackPointer(event: PointerEvent) {
    if (event.pointerType !== 'mouse' || legacyTurn) return;
    pointerAt = { x: event.clientX, y: event.clientY };
    aimTilt({ lift: 1 });
  }

  // Also runs on the server, where no frame is ever requested
  onDestroy(() => {
    if (tiltFrame) cancelAnimationFrame(tiltFrame);
    if (drawFrame) cancelAnimationFrame(drawFrame);
    clearTimeout(motionTimer);
  });
  let coverButton = $state<HTMLButtonElement>();
  let backFace = $state<HTMLElement>();

  // Makes this the one card showing its back, or gives that up
  function claimBack(showBack: boolean) {
    if (destroyed) return;
    if (showBack) flippedCard.id = uid;
    else if (flippedCard.id === uid) flippedCard.id = null;
  }

  /*
   * Focus follows the side that's showing, so keyboard users land on what they can see, except when
   * the card is turned back because another one was turned over
   */
  async function flip(
    showBack: boolean,
    {
      moveFocus = true,
      dragged = false,
      clickedAt = null,
    }: { moveFocus?: boolean; dragged?: boolean; clickedAt?: { x: number; y: number } | null } = {}
  ) {
    // While dragged, the card is the pointer's; a turn asked for meanwhile waits for it to land
    if ((dragging || settling) && !dragged) {
      pendingFlip = { showBack, moveFocus };
      return;
    }
    /*
     * Clicked again mid-turn, the card turns back from wherever it is rather than jumping to spin
     * from its far side, so rapid clicks rock it smoothly back and forth. A drag has already turned
     * the card and shown its back, so neither animates again
     */
    // Still spinning back counts too, until the card is set back to 0 degrees after the spin
    const midTurn = turnedBack || performance.now() - turnStartedAt < TURN_MS;
    // From rest, the turn's direction can change unseen: mid-turn it would make the card jump
    if (!dragged && !midTurn) {
      const direction = clickedAt && clickDirection(clickedAt);
      if (direction !== null) setTurnDirection(direction);
      // Turned over from the keyboard, or clicked dead center, the card turns sideways
      else if (showBack && !flipped) setTurnDirection(Math.PI / 2);
    }
    turnStartedAt = dragged ? 0 : performance.now();
    inMotion = true;
    clearTimeout(motionTimer);
    motionTimer = setTimeout(() => (inMotion = false), TURN_MS + 100);
    turnedBack = !dragged && !midTurn && flipped && !showBack;
    turnedByDrag = dragged;
    flipped = showBack;
    // A drag has already said which card shows its back, when it was let go
    if (!dragged) claimBack(showBack);
    if (!showBack) {
      // Turning back over discards an unsaved edit and any error, so the next flip starts fresh
      revertDrafts();
      errorMessage = null;
    }
    await tick();
    if (showBack && backFace) backFace.scrollTop = 0;
    if (!moveFocus) return;
    // Without scrolling: the card is already where the user is looking, even if partly off screen
    const options = { preventScroll: true };
    if (showBack) backFace?.querySelector<HTMLElement>('a, button, input')?.focus(options);
    else coverButton?.focus(options);
  }

  /*
   * The way the card turns, as the direction of the drag that turns it, clockwise from up: 90
   * degrees, the default, turns it sideways about its vertical axis, 180 tips it forward about its
   * horizontal one, and anything in between turns it about the axis square to the drag. Both sides
   * turn about the same axis, so the side at rest is always upright, and the axis can change between
   * turns without anything moving
   */
  let turnDirection = Math.PI / 2;
  function setTurnDirection(radians: number) {
    turnDirection = radians;
    cardElement?.style.setProperty('--turn-direction', `${radians}rad`);
    cardElement?.style.setProperty('--turn-axis-x', String(Math.cos(radians)));
    cardElement?.style.setProperty('--turn-axis-y', String(Math.sin(radians)));
  }

  /*
   * Dragging the card turns it with the pointer, in any direction, like rolling a ball under the
   * hand: each move tips it a little the way the pointer goes, so it follows every change of
   * direction without swinging round to point at the pointer. Once let go it spins on with
   * whatever speed it had, then settles upright on a side. On a touch screen, a mostly vertical
   * swipe is left to scroll the page
   */
  type Drag = {
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    width: number;
    // How far the pointer went at each recent move, to tell how fast and which way it's turning
    recent: { time: number; dx: number; dy: number }[];
    active: boolean;
  };
  let drag: Drag | null = null;
  // The card follows the pointer, then spins on and settles once let go
  let dragging = $state(false);
  // Spinning back or dragged; either side tilts toward the mouse only when at rest
  const turning = $derived(turnedBack || dragging);
  /*
   * Showing its back, or in any turn: the only times the card needs drawing in 3D, with its back
   * and the layers that turn with it. At rest on its front it's drawn flat
   */
  let inMotion = $state(false);
  let motionTimer: ReturnType<typeof setTimeout> | undefined;
  let settling = $state(false);
  const inThreeD = $derived(flipped || inMotion || turnedBack || dragging || settling);
  // A turn asked for while the card was dragged or spinning on, by Esc or a save
  let pendingFlip: { showBack: boolean; moveFocus: boolean } | null = null;
  // A drag ends with a click, which must not turn the card again
  let suppressClick = false;
  let flipperElement = $state<HTMLElement>();
  const DRAG_START_PX = 8;
  // A fingertip drifts further than a mouse while tapping, so a touch must go further to drag
  const TOUCH_DRAG_START_PX = 14;
  // How far back the turning speed is measured, smoothing out uneven pointer moves
  const SPEED_WINDOW_MS = 100;
  /*
   * Let go while turning, the card spins on and slows to a stop like a real card: it travels as
   * far as it would in this long at the speed it was let go with
   */
  const MOMENTUM_MS = 300;
  // The quickest and slowest a card takes to settle, however far its momentum carries it
  const SETTLE_MIN_MS = 420;
  const SETTLE_MAX_MS = 1600;

  // While dragged or settling, how the card is turned, drawn by the code rather than the styles
  let orientation: Rotation = IDENTITY;
  // Each drag counts up, so a drag that catches the card while the last one settles takes over
  let dragCount = 0;

  /*
   * A click turns the card over, but not while it's in the user's hand or still spinning from a
   * drag: the click would be read against the side it had before, and turn it again once it lands
   */
  // What last pressed the card: a mouse, a finger or a pen
  let pressedWith = '';

  function flipByClick(showBack: boolean, event: MouseEvent) {
    if (dragging || settling) return;
    /*
     * Only a mouse click turns the card toward where it clicked: the card leans under the mouse
     * first, so the turn's direction is no surprise. A tap gives no such hint, and turning toward
     * wherever a finger landed looks random, so taps, like clicks from the keyboard, which have no
     * position, turn the card the usual way. What made the click is told by the press before it:
     * not every browser says so on the click itself
     */
    const byMouse = event.detail > 0 && pressedWith === 'mouse';
    const clickedAt = byMouse ? { x: event.clientX, y: event.clientY } : null;
    flip(showBack, { clickedAt });
  }

  /*
   * Clicked, the card turns over toward the click: the edge nearest it lifts toward the viewer and
   * goes over, as it leans under the mouse. As a turn direction, that's from the click toward the
   * card's middle; none for a click too near the middle to tell
   */
  function clickDirection(clickedAt: { x: number; y: number }): number | null {
    if (!cardElement) return null;
    const rect = cardElement.getBoundingClientRect();
    const towardMiddleX = (rect.left + rect.width / 2 - clickedAt.x) / rect.width;
    const towardMiddleY = (rect.top + rect.height / 2 - clickedAt.y) / rect.height;
    if (Math.hypot(towardMiddleX, towardMiddleY) < 0.08) return null;
    return Math.atan2(towardMiddleX, -towardMiddleY);
  }

  // The axis the card turns about between drags, which its back is turned about too
  const restingAxis = () => [Math.cos(turnDirection), Math.sin(turnDirection)] as const;

  let backLightElement = $state<HTMLElement>();

  // The gloss on one side, where the light catches it as the card is turned; none gives it back
  // to the mouse
  function setGloss(element: HTMLElement | undefined, face: Rotation | null) {
    if (!element) return;
    if (!face) {
      for (const name of ['--gloss-x', '--gloss-y', '--gloss']) element.style.removeProperty(name);
      return;
    }
    const highlight = highlightOn(face);
    element.style.setProperty('--gloss-x', String(highlight.x));
    element.style.setProperty('--gloss-y', String(highlight.y));
    element.style.setProperty('--gloss', String(highlight.strength));
  }

  /*
   * Draws the card as it's turned now. Pointer moves can come several to a frame, so they turn the
   * card at once but draw it at most once a frame
   */
  let drawFrame = 0;
  function drawSoon() {
    if (!drawFrame) drawFrame = requestAnimationFrame(drawOrientation);
  }

  function drawOrientation() {
    drawFrame = 0;
    const rotation = orientation;
    // The light and the lift follow how far the front has turned from the viewer, and which way
    const tilt = tiltOf(rotation);
    cardElement?.style.setProperty('--drag-transform', toCss(rotation));
    cardElement?.style.setProperty('--drag-angle', `${tilt.degrees}deg`);
    cardElement?.style.setProperty('--turn-direction', `${tilt.direction}rad`);
    /*
     * Each side shines where a light above and to the left would catch it, so the highlight
     * slides over whichever side faces up as the card is tumbled. The back is turned within the
     * card, so it sees the light from its own angle
     */
    setGloss(cardElement, rotation);
    setGloss(backLightElement, multiply(rotation, axisAngle(...restingAxis(), 0, 180)));
  }

  // Where the card is turned to right now, mid-turn or not
  function currentTurn() {
    const resting = flipped ? 180 : 0;
    if (!flipperElement || legacyTurn) return resting;
    const turn = parseFloat(getComputedStyle(flipperElement).getPropertyValue('--card-turn'));
    return Number.isFinite(turn) ? turn : resting;
  }

  function startDrag(event: PointerEvent) {
    pressedWith = event.pointerType;
    if (!event.isPrimary || event.button !== 0 || drag?.active || !cardElement) return;
    // The cover is a button, but every other control keeps its own pointer behavior
    const target = event.target as Element;
    if (
      target.closest('a, button:not(.cover), input, select, textarea, label, form, .back-actions')
    )
      return;
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      width: cardElement.offsetWidth,
      recent: [],
      active: false,
    };
  }

  function moveDrag(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.active) {
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      const dragStart = event.pointerType === 'touch' ? TOUCH_DRAG_START_PX : DRAG_START_PX;
      if (Math.abs(dx) < dragStart && Math.abs(dy) < dragStart) return;
      if (event.pointerType === 'touch' && Math.abs(dy) > Math.abs(dx)) {
        drag = null;
        return;
      }
      /*
       * The drag catches the card wherever it is, even mid-turn or still settling from the last
       * drag, and turns it on from there. Caught at rest, it turns over about the axis square to
       * the way the drag sets off, as its back does, so the back comes round upright whichever way
       * the card is first pulled
       */
      if (!settling) {
        const turn = currentTurn();
        if (Math.abs(turn - Math.round(turn / 180) * 180) < 1)
          setTurnDirection(Math.atan2(dx, -dy));
        orientation = axisAngle(...restingAxis(), 0, turn);
        drawOrientation();
      }
      // The turn starts here, not where the pointer went down, so the distance it took to count
      // as a drag doesn't turn the card all at once
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      drag.active = true;
      dragCount++;
      dragging = true;
      settling = false;
      turnedBack = false;
      flipperElement?.setPointerCapture(event.pointerId);
    }
    // Each move tips the card the way the pointer went, about the axis square to it: a card's
    // width of drag turns it over once
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    const distance = Math.hypot(dx, dy);
    if (distance > 0) {
      orientation = multiply(axisAngle(-dy, dx, 0, (distance / drag.width) * 180), orientation);
      drawSoon();
    }
    drag.recent.push({ time: event.timeStamp, dx, dy });
    while (drag.recent[0].time < event.timeStamp - SPEED_WINDOW_MS) drag.recent.shift();
  }

  async function endDrag(event: PointerEvent, { cancelled = false } = {}) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { active, recent, width } = drag;
    drag = null;
    if (!active) return;
    suppressClick = true;
    setTimeout(() => (suppressClick = false));

    /*
     * How fast the pointer was going, and which way, over the last moves; the card rolls on the
     * same way, about the axis square to it. A pause before letting go leaves no moves, as they've
     * all aged out of the window
     */
    const fresh = recent.filter(({ time }) => time >= event.timeStamp - SPEED_WINDOW_MS);
    const elapsed = fresh.length > 1 ? fresh.at(-1)!.time - fresh[0].time : 0;
    let speedX = 0;
    let speedY = 0;
    if (!cancelled && elapsed > 0) {
      // The first move happened before the window's span began
      for (const move of fresh.slice(1)) {
        speedX += move.dx / elapsed;
        speedY += move.dy / elapsed;
      }
    }
    const spin = { x: -speedY, y: speedX, z: 0 };
    // In degrees per millisecond, a card's width of drag being half a turn
    const speed = (Math.hypot(speedX, speedY) / width) * 180;

    /*
     * The card spins on as far as its momentum carries it, then settles upright on whichever side
     * is nearest there. It sets off at the speed it was let go with and slows to a stop, taking
     * longer the further it has to go
     */
    const from = orientation;
    const momentum = speed * MOMENTUM_MS;
    const spunTo = multiply(axisAngle(spin.x, spin.y, spin.z, momentum), from);
    const back = axisAngle(...restingAxis(), 0, 180);
    const showBack = angleBetween(spunTo, back) < angleBetween(spunTo, IDENTITY);
    /*
     * Letting go is what counts for which card shows its back, not where the card lands: a card
     * turned over while this one was in hand gives way to it, and one turned over while this one
     * spins on takes over from it
     */
    claimBack(showBack);
    // The last little turn that sets it upright on that side
    const upright = toAxisAngle(multiply(showBack ? back : IDENTITY, inverse(spunTo)));
    const duration = Math.min(
      SETTLE_MAX_MS,
      Math.max(SETTLE_MIN_MS, 300 + (momentum + upright.degrees) * 1.5)
    );
    // Eases out from about the speed it was let go with
    const easeOut = momentum > 1 ? Math.min(5, Math.max(2, (speed * duration) / momentum)) : 3;

    const thisDrag = dragCount;
    settling = true;
    const landed = await new Promise<boolean>((resolve) => {
      const start = performance.now();
      const step = (now: number) => {
        // Caught again while settling, the new drag takes it from here; gone, there's nothing
        // to land
        if (thisDrag !== dragCount || destroyed) return resolve(false);
        const progress = Math.min(1, (now - start) / duration);
        const eased = 1 - (1 - progress) ** easeOut;
        orientation = multiply(
          axisAngle(upright.x, upright.y, upright.z, upright.degrees * eased),
          multiply(axisAngle(spin.x, spin.y, spin.z, momentum * eased), from)
        );
        drawOrientation();
        if (progress < 1) requestAnimationFrame(step);
        else resolve(true);
      };
      requestAnimationFrame(step);
    });
    if (!landed) return;

    // Upright on a side, the card hands back to the styles, which draw that side the same way
    await swapTurn(async () => {
      dragging = false;
      settling = false;
      setTurnDirection(turnDirection);
      setGloss(cardElement, null);
      setGloss(backLightElement, null);
      if (showBack !== flipped) await flip(showBack, { dragged: true });
    });
    const pending = pendingFlip;
    pendingFlip = null;
    if (pending && pending.showBack !== flipped)
      await flip(pending.showBack, { moveFocus: pending.moveFocus });
  }

  /*
   * Only one card shows its back at a time: this one turns back when another is turned over, a
   * moment later, so the two turns follow each other rather than happen at once. While this card
   * is dragged it's in the user's hand, so it waits until it lands, then checks again
   */
  const TURN_BACK_DELAY_MS = 100;
  $effect(() => {
    if (!flipped || flippedCard.id === uid || dragging || settling) return;
    const timer = setTimeout(() => flip(false, { moveFocus: false }), TURN_BACK_DELAY_MS);
    return () => clearTimeout(timer);
  });

  const submitEntry: SubmitFunction = ({ formData }) => {
    saving = true;
    errorMessage = null;
    const stateBefore = watchState;
    const progressBefore = anime.currentEpisode;
    const positionBefore = position;
    const scored = formData.has('score') && scoreChanged;

    return async ({ result, update }) => {
      try {
        if (result.type === 'failure') {
          errorMessage = (result.data?.message as string | undefined) ?? 'The update failed';
          return;
        }
        if (result.type === 'success') {
          const saved = {
            ...anime,
            currentEpisode: Number(result.data?.progress),
            userScore: Number(result.data?.score) || null,
          };
          // A new episode count shows on the front; a score alone stays in view on the back
          if (flipped && saved.currentEpisode !== progressBefore) await flip(false);

          // Celebrate only the moment the user catches up or finishes, judged by what AniList saved
          const stateAfter = getWatchState(saved);
          const wasDone = stateBefore === 'caught-up' || stateBefore === 'completed';
          if (!wasDone && (stateAfter === 'caught-up' || stateAfter === 'completed')) {
            onCaughtUp?.(stateAfter, saved, { scored });
          }
          // The card may be replaced as the confirmed progress moves it to a new section.
          if (saved.currentEpisode !== progressBefore)
            countsBeforeSave.set(anime.id, episodesToWatch);
          onConfirmed(saved, String(result.data?.status ?? ''));
        }
        // Reloads the list, so the card shows what AniList saved
        await update({ reset: false });
        if (result.type === 'success') onSaved?.(anime.id, positionBefore);
      } finally {
        saving = false;
      }
    };
  };
</script>

<!-- Esc turns the card back over while focus is on its back; in a dropdown, it only closes the list -->
<svelte:window
  onkeydown={(event) => {
    if (
      event.key === 'Escape' &&
      !event.defaultPrevented &&
      !(event.target instanceof HTMLSelectElement) &&
      flipped &&
      backFace?.contains(document.activeElement)
    )
      flip(false);
  }}
/>

<!-- Every badge sits in the same place, centered on top of the card, so they're easy to scan -->
{#snippet badge()}
  {#if watchState === 'completed'}
    <span class="card-badge tw:badge tw:badge-success">✓ Completed</span>
  {:else if watchState === 'caught-up'}
    <span
      class="card-badge tw:badge tw:badge-success"
      class:splash={justCaughtUp}
      title={countdown?.date}
      aria-label={countdown?.spoken}
    >
      ✓ {countdown?.label ?? 'Caught up'}
    </span>
  {:else if noEpisodeInfo}
    <span class="card-badge tw:badge tw:badge-neutral" title={noEpisodeInfo.title}>
      {noEpisodeInfo.label}
    </span>
  {:else if watchState === 'to-watch' && anime.rewatching}
    <!-- A rewatch isn't "behind": its episodes aren't new, so it gets a calmer badge -->
    <span
      class="card-badge tw:badge rewatch-badge"
      title="Rewatching"
      aria-label={`Rewatching, ${episodesToWatch} episode${episodesToWatch === 1 ? '' : 's'} left`}
    >
      ↻ {episodesToWatch.toLocaleString()} left
    </span>
  {:else if watchState === 'to-watch'}
    <span
      class="card-badge tw:badge behind-badge"
      class:new-episode={newEpisode}
      class:deep={episodesToWatch >= BIG_BACKLOG}
      aria-label={`${newEpisode ? 'New episode. ' : ''}${episodesToWatch} episode${episodesToWatch === 1 ? '' : 's'} to watch`}
    >
      {#if newEpisode}New ·{/if}
      {#key countTicks}
        <span class="count" class:ticked={countTicks > 0}>{episodesToWatch.toLocaleString()}</span>
      {/key}
      behind
    </span>
  {/if}
{/snippet}

<!-- Following the mouse is decoration only, so it needs no keyboard or screen reader equivalent -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="card-slot tw:h-full"
  class:highlight={highlighted}
  onpointermove={trackPointer}
  onpointerleave={() => {
    pointerAt = null;
    aimTilt({ x: 0, y: 0, lift: 0 });
  }}
>
  <div
    class="anime-card"
    class:flipped
    class:turned-back={turnedBack}
    class:dragging
    class:turned-by-drag={turnedByDrag}
    class:settling
    class:in-3d={inThreeD}
    class:legacy-turn={legacyTurn}
    bind:this={cardElement}
  >
    <!--
      A click anywhere on the card turns it over, except on its badge, links, buttons and form
      fields, and around the actions at the bottom of the back, so a click that just misses one
      doesn't. It's handled here rather than on each side, so it works mid-turn too: the side being
      left is already inert. Keyboard users have the cover button, so the click needs no key
      equivalent.
    -->
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div
      class="flipper"
      bind:this={flipperElement}
      onpointerdown={startDrag}
      onpointermove={moveDrag}
      onpointerup={(event) => endDrag(event)}
      onpointercancel={(event) => endDrag(event, { cancelled: true })}
      onlostpointercapture={(event) => endDrag(event, { cancelled: true })}
      ondragstart={(event) => event.preventDefault()}
      onclickcapture={(event) => {
        if (!suppressClick) return;
        event.stopPropagation();
        event.preventDefault();
      }}
      onclick={(event) => {
        const target = event.target as Element;
        if (
          !target.closest(
            'a, button, input, select, textarea, label, form, .back-actions, .badge-side'
          )
        ) {
          flipByClick(!flipped, event);
        }
      }}
    >
      <!--
        The badge turns with the card, on whichever side faces the viewer. The copy on the back is
        only for show, so screen readers hear it once
      -->
      <div class="badge-side front-side">{@render badge()}</div>
      <div class="back-side" aria-hidden="true">
        <div class="badge-side">{@render badge()}</div>
      </div>
      <!--
        The light that glances off the back as it turns, over it rather than inside it, so it stays
        put when the back's details scroll. The back has no gloss under the mouse
      -->
      <div class="back-light" aria-hidden="true" bind:this={backLightElement}>
        <span class="glare"></span>
      </div>
      <!-- Only the side facing the viewer can be focused or read by a screen reader -->
      <div class="face front tw:card" inert={flipped}>
        <!-- A soft light on the cover where the mouse is -->
        <span class="glare" aria-hidden="true"></span>
        <button
          class="cover"
          bind:this={coverButton}
          onclick={(event) => flipByClick(true, event)}
          aria-label={`${anime.title}, show details`}
        >
          <!-- Clips the cover's hover zoom to its frame -->
          <span class="cover-frame" class:mature={coverBlurred}>
            <img
              src={anime.thumbnailUrl}
              alt=""
              loading="lazy"
              class:up-to-date={episodesToWatch === 0}
            />
            <span class="holo" aria-hidden="true"></span>
            {#if coverBlurred}
              <span class="mature-label">18+</span>
            {/if}
          </span>
          <!-- Always two lines tall, so every card is the same height; the full title shows on hover -->
          <span class="title tw:text-center tw:font-bold tw:line-clamp-2" title={anime.title}
            >{anime.title}</span
          >
        </button>
        <div class="progression">
          {#if totalEpisodes && barParts}
            <!-- Watched, then aired but not watched yet, then not aired yet -->
            <div
              class="episode-bar"
              role="progressbar"
              aria-label="Episode progress"
              aria-valuemin={0}
              aria-valuemax={totalEpisodes}
              aria-valuenow={Math.min(anime.currentEpisode, totalEpisodes)}
              aria-valuetext={barParts.description}
            >
              <span class="watched" style:width="{barParts.watched}%"></span>
              <span class="aired" style:width="{barParts.aired}%"></span>
            </div>
          {/if}
          <span class="tw:text-sm tw:opacity-70">{progressLabel}</span>
          {#if canEdit && (watchState === 'to-watch' || watchState === 'next-episode-unscheduled')}
            <form method="POST" action="?/updateEntry" use:enhance={submitEntry}>
              <input type="hidden" name="mediaId" value={anime.id} />
              <input type="hidden" name="progress" value={anime.currentEpisode + 1} />
              <button
                class="tw:btn tw:btn-primary tw:btn-xs"
                disabled={saving}
                aria-label={`Mark episode ${anime.currentEpisode + 1} of ${anime.title} as watched`}
              >
                {#if saving}<span class="tw:loading tw:loading-spinner tw:loading-xs"
                  ></span>{:else}+1{/if}
              </button>
            </form>
          {/if}
        </div>
        {#if errorMessage && !flipped}
          <!-- Over the cover rather than below it, so every card keeps the same height -->
          <p class="front-error tw:text-error tw:text-xs" role="alert">{errorMessage}</p>
        {/if}
      </div>

      <!--
        The back: the details the popup used to show. Keyboard and screen reader users turn it back
        over with Esc
      -->
      <div
        class="face back tw:card"
        bind:this={backFace}
        inert={!flipped}
        role="group"
        aria-label={`${anime.title} details`}
        aria-keyshortcuts="Escape"
      >
        <!--
          Always two lines tall, so the details sit at the same height on every card. Only the
          title's own text is the link; the space around a short title turns the card back over
        -->
        <p class="back-title">
          <a href={animeLinkFn(anime.id)} target="_blank" title={anime.title}>
            {anime.title}<span class="tw:sr-only">, on AniList, opens in a new tab</span>
          </a>
        </p>

        <!-- Details retain their height; short cards scroll the whole back to keep fields reachable. -->
        <div class="facts-area">
          <dl class="facts">
            <dt>Watched</dt>
            <dd>
              {#if canEdit}
                <!-- Its form, with the one Save button for the count and the score, is below -->
                <span class="field-form">
                  <input
                    class="tw:input tw:input-xs tw:w-16"
                    type="number"
                    name="progress"
                    form={entryFormId}
                    min="0"
                    max={totalEpisodes ?? undefined}
                    bind:value={watchedDraft}
                    aria-label="Episodes watched"
                    required
                  />
                  <span>/ {totalEpisodes ?? '?'}</span>
                </span>
              {:else}
                {progressLabel}
              {/if}
              {#if airedNote}<span class="aired-note">({airedNote})</span>{/if}
            </dd>
            {#if canEdit}
              <dt>Score</dt>
              <dd>
                <!-- In the owner's AniList scoring system; "No score" or an empty field clears it -->
                <span class="field-form">
                  <ScoreInput
                    format={scoreFormat}
                    bind:value={scoreDraft}
                    label="Your score"
                    form={entryFormId}
                  />
                </span>
              </dd>
            {:else if anime.userScore}
              <dt>Score</dt>
              <dd>
                <span aria-hidden="true">{formatScore(anime.userScore, scoreFormat)}</span>
                <span class="tw:sr-only">{describeScore(anime.userScore, scoreFormat)}</span>
              </dd>
            {/if}
            {#if anime.meanScore}
              <!-- AniList's mean score: the average of everyone's scores there -->
              <dt>Average</dt>
              <dd>{formatMeanScore(anime.meanScore)}</dd>
            {/if}
            {#if anime.rewatching}
              <dt>Status</dt>
              <dd>Rewatching</dd>
            {/if}
            {#if mounted && anime.nextEpisode}
              <dt>Next</dt>
              <dd>Ep {anime.nextEpisode.number}, {formatAirDate(anime.nextEpisode.airsAt)}</dd>
            {/if}
          </dl>
        </div>

        <!--
          At the bottom when there is room, otherwise after the details in the same scroll area.
          Only there when it holds something, as clicks on it don't turn the card
        -->
        {#if canEdit || nextToWatch || (errorMessage && flipped)}
          <div class="back-actions">
            {#if canEdit}
              <!--
              Saves the watched count and the score together; Enter in either field saves too. Revert
              puts both back to what's saved on AniList
            -->
              <form
                id={entryFormId}
                class="entry-actions"
                method="POST"
                action="?/updateEntry"
                use:enhance={submitEntry}
              >
                <input type="hidden" name="mediaId" value={anime.id} />
                <input type="hidden" name="scoreFormat" value={scoreFormat} />
                <button
                  type="button"
                  class="tw:btn tw:btn-ghost tw:btn-xs"
                  disabled={saving || !entryChanged}
                  onclick={revertDrafts}
                >
                  Revert
                </button>
                <button class="tw:btn tw:btn-primary tw:btn-xs" disabled={saving || !entryChanged}>
                  Save
                </button>
              </form>
            {/if}
            {#if nextToWatch}
              <a
                class="download-link"
                href={nyaaSearchUrl({
                  title: anime.title,
                  englishTitle: anime.englishTitle,
                  otherTitles: anime.otherTitles,
                  episode: nextToWatch,
                  language: downloadLanguage,
                  version: downloadVersion,
                  adult: anime.isAdult,
                })}
                target="_blank"
                rel="noreferrer"
              >
                <!-- Always two lines, one each, so the button is the same size for either site -->
                <span class="download-line"
                  ><span class="download-words">Find episode</span> {nextToWatch}</span
                >
                <span class="download-line download-site">on {nyaaSite(anime.isAdult)}</span>
                <span class="tw:sr-only">, opens in a new tab</span>
              </a>
            {/if}
            {#if errorMessage && flipped}
              <p class="tw:text-error tw:text-sm" role="alert">{errorMessage}</p>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  /* Shrinks to its card, and holds the badge and card in place */
  .card-slot {
    position: relative;
    display: inline-flex;
    width: max-content;
  }

  .anime-card {
    /* Every badge's height, which also sets how far it rises above the card's top edge */
    --badge-height: 1.75rem;
    /* Set by the page grid, which sizes cards to fit the screen */
    width: var(--card-width, 300px);
    max-width: 100%;
    /* Gives the flip its depth */
    perspective: 1400px;
    /* Clicking turns the card over, so a quick double click shouldn't select its text */
    user-select: none;
  }

  /* The episode count field stays editable like any other */
  .anime-card input {
    user-select: text;
  }

  /*
   * How far the card has turned. Turning over, spinning back and dragging all animate this one
   * angle, so the reflection on each side can follow the turn as it happens
   */
  @property --card-turn {
    syntax: '<angle>';
    inherits: true;
    initial-value: 0deg;
  }

  /* Both sides turn together; the front sets the card's height and the back sits behind it */
  .flipper {
    position: relative;
    height: 100%;
    transform-style: preserve-3d;
    -webkit-tap-highlight-color: transparent;
    transform: rotate3d(var(--turn-axis-x), var(--turn-axis-y), 0, var(--card-turn));
    transition: --card-turn 760ms cubic-bezier(0.22, 0.8, 0.24, 1.06);
  }

  .flipped .flipper {
    --card-turn: 180deg;
  }

  /* Without a registered `--card-turn`, the transform itself animates the turn */
  @media (prefers-reduced-motion: no-preference) {
    .legacy-turn .flipper {
      transition: transform 760ms cubic-bezier(0.22, 0.8, 0.24, 1.06);
    }
    .legacy-turn.dragging .flipper {
      transition: none;
    }
  }

  /* How edge-on the card is, from 0 lying flat to 1 side-on, for the light and lift that follow it */
  .flipper {
    --edge-on: max(sin(var(--card-turn)), -1 * sin(var(--card-turn)));
  }

  .front {
    overflow: hidden;
  }

  /*
   * The badge, centered on the card's top edge, one on each side just above its face, so it tilts,
   * rises and turns with the card and shows on whichever side faces the viewer. It's centered with
   * auto margins and half its height above the edge, not shifted by a share of its own size: that
   * relies on the `translate` property, which not every browser or build applies, leaving the
   * badge off to the right
   */
  .badge-side {
    position: absolute;
    top: calc(var(--badge-height) / -2);
    right: 0;
    left: 0;
    z-index: 3;
    display: flex;
    /* As wide as its badge, so it centers rather than stretching across the card */
    width: max-content;
    margin-inline: auto;
    backface-visibility: hidden;
    transform: translateZ(2px);
  }

  /*
   * The back's badge sits in a layer the size of the card, turned exactly as the back is, about the
   * card's center. Turned about its own center instead, a turn on any axis but the vertical one
   * would carry it away from the top of the back
   */
  .back-side {
    position: absolute;
    inset: 0;
    backface-visibility: hidden;
    transform: rotate3d(var(--turn-axis-x), var(--turn-axis-y), 0, 180deg) translateZ(2px);
    pointer-events: none;
  }

  .back-side .badge-side {
    transform: none;
    pointer-events: auto;
  }

  /* The badge facing away doesn't pulse; it starts when its side comes round */
  .anime-card:not(.flipped, .dragging) .back-side .card-badge::after,
  .flipped:not(.dragging) .front-side .card-badge::after {
    animation: none;
  }

  /*
   * As the card turns, light glances off it: a bright band slides across each side and the side
   * dims as it turns away, both strongest edge-on and gone when the card lies flat. The band leaves
   * the front on one edge and comes onto the back from the other, so the sweep carries on across
   * the turn
   */
  .front::before,
  .back-light::before {
    --turn-band: calc(50% - sin(var(--card-turn)) * 70%);
    content: '';
    position: absolute;
    inset: 0;
    z-index: 2;
    border-radius: inherit;
    background:
      linear-gradient(
        calc(var(--turn-direction) + 10deg),
        transparent calc(var(--turn-band) - 28%),
        rgb(255 255 255 / 0.55) var(--turn-band),
        transparent calc(var(--turn-band) + 28%)
      ),
      rgb(2 10 20 / calc(var(--edge-on) * 0.25));
    opacity: var(--edge-on);
    pointer-events: none;
  }

  .back-light::before {
    --turn-band: calc(50% + sin(var(--card-turn)) * 70%);
  }

  /* Lies just over the back, turned with it, and clipped to its corners */
  .back-light {
    position: absolute;
    inset: 0;
    overflow: hidden;
    border-radius: var(--radius-box);
    backface-visibility: hidden;
    transform: rotate3d(var(--turn-axis-x), var(--turn-axis-y), 0, 180deg) translateZ(1px);
    pointer-events: none;
  }

  @keyframes detail-reveal {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes detail-fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: no-preference) {
    .flipped:not(.turned-by-drag) .back-title {
      animation: detail-reveal 300ms ease-out 220ms both;
    }
    .flipped:not(.turned-by-drag) .facts {
      animation: detail-fade 340ms ease-out 280ms both;
    }
    .flipped:not(.turned-by-drag) .back-actions {
      animation: detail-fade 340ms ease-out 340ms both;
    }
    /*
     * Mid-turn, the card rises toward the viewer, highest when edge-on, so it swings clear of its
     * neighbours. It follows the angle, so it's smooth however the turn goes, clicked or dragged
     */
    .flipper {
      translate: 0 calc(var(--edge-on) * -8px) calc(var(--edge-on) * 60px);
    }
  }

  /*
   * Turning back, the card keeps spinning the way it turned over, on round to a full turn, rather
   * than unwinding; once there, it's set back to 0 degrees, which looks the same. As a transition
   * like any other turn, a click mid-spin turns it back from wherever it is
   */
  .card-slot:has(.turned-back) {
    z-index: 2;
  }
  .turned-back .flipper {
    --card-turn: 360deg;
  }

  .anime-card {
    /* Which way the card turns, set by dragging it; sideways unless dragged otherwise */
    --turn-direction: 90deg;
    --turn-axis-x: 0;
    --turn-axis-y: 1;
    /* Set while the mouse moves over the card; at rest the card lies flat, with no gloss */
    --pointer-x: 0;
    --pointer-y: 0;
    --lift: 0;
    /* Where the gloss shines and how brightly: under the mouse, unless the card is being turned */
    --gloss-x: var(--pointer-x);
    --gloss-y: var(--pointer-y);
    --gloss: var(--lift);
    /*
     * On the dark navy page, the card is lighter than other surfaces and has a faint sky-blue
     * edge, with deeper shadows, so it stands out as it does on the light page
     */
    --card-surface: light-dark(var(--surface), #24425f);
    --card-edge: light-dark(transparent, rgb(159 220 255 / 0.2));
    --card-shadow: light-dark(rgb(0 0 0 / 0.1), rgb(2 10 20 / 0.5));
    --card-shadow-deep: light-dark(rgb(15 48 79 / 0.45), rgb(2 10 20 / 0.75));
  }

  /*
   * The gloss on the tilted card: a soft highlight where the mouse is, and a broad diagonal
   * reflection running through it, so the light stays with the mouse even at the card's edges
   */
  .glare {
    /* Where the reflection crosses its diagonal, the mouse's position measured along it */
    --band: calc(50% + (var(--gloss-x) * 0.9 + var(--gloss-y) * 0.42) * 100%);
    position: absolute;
    inset: 0;
    z-index: 1;
    border-radius: inherit;
    background:
      radial-gradient(
        ellipse 70% 50% at calc(50% + var(--gloss-x) * 100%) calc(50% + var(--gloss-y) * 100%),
        rgb(255 255 255 / 0.55),
        rgb(255 255 255 / 0.18) 40%,
        transparent 75%
      ),
      linear-gradient(
        115deg,
        transparent calc(var(--band) - 22%),
        rgb(255 255 255 / 0.22) var(--band),
        transparent calc(var(--band) + 22%)
      );
    mix-blend-mode: overlay;
    opacity: var(--gloss);
    transition: opacity 250ms ease-out;
    pointer-events: none;
  }

  /* A faint rainbow foil on the cover, strongest near the light and shifting as the card tilts */
  .holo {
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(
        115deg,
        hsl(350 90% 72%) 0%,
        hsl(45 95% 70%) 6%,
        hsl(150 80% 68%) 12%,
        hsl(200 95% 70%) 18%,
        hsl(270 85% 74%) 24%,
        hsl(350 90% 72%) 30%
      )
      calc(50% + var(--gloss-x) * 90%) calc(50% + var(--gloss-y) * 90%) / 300% 300%;
    mask-image: radial-gradient(
      circle at calc(50% + var(--gloss-x) * 100%) calc(50% + var(--gloss-y) * 100%),
      #000,
      transparent 75%
    );
    mix-blend-mode: color-dodge;
    opacity: calc(var(--gloss) * 0.28);
    transition: opacity 250ms ease-out;
    pointer-events: none;
  }

  /* No gloss mid-spin, which keeps the spin light to draw */
  .turned-back :is(.glare, .holo) {
    opacity: 0;
  }

  /*
   * Most cards, most of the time, lie on their front with nothing moving. Those are drawn flat:
   * their back, the layers that turn with it and the turn's reflection are left out, and nothing is
   * lifted into 3D, so the page doesn't hold a stack of 3D layers for every card. A card only
   * becomes 3D while it shows its back or turns, and only tilts while the mouse is over it
   */
  .anime-card:not(.in-3d) .flipper {
    transform-style: flat;
  }
  .anime-card:not(.in-3d) :is(.back, .back-light, .back-side),
  .anime-card:not(.in-3d) .front::before {
    display: none;
  }
  .anime-card:not(.in-3d) .front-side {
    transform: none;
  }
  .anime-card:not(.in-3d, [data-lit]) .flipper {
    transform: none;
    translate: none;
  }
  .anime-card:not([data-lit], .dragging) :is(.glare, .holo) {
    display: none;
  }
  /* The back only shines while it's being turned, not under the mouse */
  .anime-card:not(.dragging) .back-light .glare {
    display: none;
  }

  @media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) {
    .card-slot:hover {
      z-index: 2;
    }
    /*
     * The card tilts toward the mouse and rises off the page, the edge under the mouse rising
     * toward the viewer, while keeping its layout anchored. The tilt eases out while the card
     * turns, so it never fights the turn
     */
    .flipper {
      transform: translateZ(calc(var(--lift) * 36px)) rotateX(calc(var(--pointer-y) * 18deg))
        rotateY(calc(var(--pointer-x) * -24deg))
        rotate3d(var(--turn-axis-x), var(--turn-axis-y), 0, var(--card-turn));
    }
    /* Its shadow falls away from the light and spreads as it rises, on either side */
    .card-slot:hover .face {
      box-shadow:
        0 0 0 2px var(--you-blue),
        calc(var(--pointer-x) * -36px) calc(20px + var(--pointer-y) * -30px)
          calc(24px + var(--lift) * 24px) -12px var(--card-shadow-deep),
        0 8px 24px -10px rgb(73 185 249 / 0.45);
      /* It follows the mouse every frame already */
      transition: none;
    }
  }

  /*
   * While dragged, and while it spins on and settles, the card is turned by the code, however it's
   * been tumbled, ahead of any side; the light and lift still follow how far it has turned. On a
   * touch screen, a swipe that starts vertical still scrolls the page
   */
  .flipper {
    touch-action: pan-y;
  }
  .card-slot:has(.dragging) {
    z-index: 2;
  }
  .anime-card.dragging .flipper {
    --card-turn: var(--drag-angle);
    transform: var(--drag-transform);
    transition: none;
  }
  /* Where the card tilts toward the mouse, the tilt eases out on top of the drag */
  @media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) {
    .anime-card.dragging .flipper {
      transform: translateZ(calc(var(--lift) * 36px)) rotateX(calc(var(--pointer-y) * 18deg))
        rotateY(calc(var(--pointer-x) * -24deg)) var(--drag-transform);
    }
  }

  .face {
    height: 100%;
    padding: 10px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    background: var(--card-surface);
    color: var(--color-base-content);
    /* Tailwind's shadow-xl, darker on the dark page, plus the card's edge */
    box-shadow:
      0 0 0 1px var(--card-edge),
      0 20px 25px -5px var(--card-shadow),
      0 8px 10px -6px var(--card-shadow);
    backface-visibility: hidden;
    transition: box-shadow 420ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  /* After a save moves the card, a sky-blue ring that fades out, so the eye finds it again */
  .highlight .face {
    animation: found 2s ease-out;
  }

  @keyframes found {
    0%,
    40% {
      box-shadow:
        0 0 0 4px var(--you-blue),
        0 0 28px 6px rgb(73 185 249 / 0.6);
    }
  }

  .card-slot:has(:focus-visible) .face {
    box-shadow:
      0 0 0 2px var(--you-blue),
      0 22px 38px -16px var(--card-shadow-deep),
      0 8px 24px -10px rgb(73 185 249 / 0.4);
  }

  /* A fixed layout from the top: title, details, then any error at the bottom */
  .back {
    position: absolute;
    inset: 0;
    justify-content: flex-start;
    gap: 12px;
    --back-padding-y: 16px;
    --back-padding-x: 14px;
    padding: var(--back-padding-y) var(--back-padding-x);
    overflow-x: hidden;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: color-mix(in srgb, var(--text-accent) 45%, transparent) transparent;
    scrollbar-gutter: stable;
    overscroll-behavior: contain;
    text-align: center;
    transform: rotate3d(var(--turn-axis-x), var(--turn-axis-y), 0, 180deg);
    /* The details adapt to the card's own width, which the page grid sets */
    container-type: inline-size;
  }

  /*
   * The pointer is set on the turning container, not on each side, so it stays while the card
   * turns, when the side being left is already inert. Forms keep the usual cursor
   */
  .flipper {
    cursor: pointer;
  }

  .flipper form {
    cursor: auto;
  }

  .back-title {
    display: -webkit-box;
    flex: none;
    height: 2lh;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    color: var(--text-heading);
    font-size: 1.05rem;
    font-weight: 800;
    line-height: 1.3;
  }

  .back-title a:hover,
  .back-title a:focus-visible {
    color: var(--text-accent);
    text-decoration: underline;
  }

  /* As wide as the card's back, not its widest field, which then fits inside it */
  .facts-area {
    align-self: stretch;
    display: flex;
    /* The details keep together at the top, whatever room is left below them */
    align-items: flex-start;
    justify-content: center;
    flex: none;
    min-width: 0;
    /* Room for the fields' focus rings. */
    padding: 3px;
  }

  .facts {
    min-width: 0;
    max-width: 100%;
    display: grid;
    align-content: start;
    grid-template-columns: auto auto;
    gap: 4px 12px;
    font-size: 0.9rem;
  }

  .facts dt {
    color: var(--text-accent);
    font-weight: 700;
    text-align: right;
  }

  .facts dd {
    text-align: left;
  }

  .field-form {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    /* Never wider than the card, so a long score choice is cut short instead */
    max-width: 100%;
    min-width: 0;
  }

  /* "/ 224" stays in one piece */
  .field-form span {
    white-space: nowrap;
  }

  /*
   * On a narrow card, each label sits above its value instead of beside it, so the Watched field,
   * the total and Save fit on one line
   */
  @container (max-width: 15rem) {
    .facts {
      grid-template-columns: 1fr;
      justify-items: center;
      gap: 0;
      line-height: 1.25;
    }

    .facts dt,
    .facts dd {
      max-width: 100%;
      text-align: center;
    }

    /* Smaller labels, so more of the details fit before they have to scroll */
    .facts dt {
      font-size: 0.75rem;
    }

    .facts dd + dt {
      margin-top: 6px;
    }
  }

  /* Revert and Save, at the bottom with the other actions */
  .entry-actions {
    display: flex;
    justify-content: center;
    gap: 8px;
  }

  .back-actions {
    display: flex;
    flex: none;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    /* Reaches over the back's padding, so a click that just misses an action, below or beside it,
       doesn't turn the card */
    margin: auto calc(-1 * var(--back-padding-x)) calc(-1 * var(--back-padding-y));
    padding: 0 var(--back-padding-x) var(--back-padding-y);
    /* The back centers its content; this spans it, so the link is as wide as the card */
    align-self: stretch;
  }

  .aired-note {
    margin-left: 4px;
    color: var(--text-accent);
    font-size: 0.8rem;
    white-space: nowrap;
  }

  /* A pill as wide as the card allows, so it's an easy target rather than a line of small text */
  .download-link {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 100%;
    /* Little side padding, so both lines fit even on the smallest cards */
    padding: 0.35rem 0.25rem;
    border: 2px solid var(--you-blue);
    border-radius: 999px;
    background: var(--you-blue-pale);
    color: var(--text-accent);
    font-size: 0.85rem;
    font-weight: 700;
    line-height: 1.2;
    text-align: center;
    transition:
      background-color 0.15s ease-out,
      color 0.15s ease-out;
  }

  /*
   * Each line stays on one line, cut short on the narrowest cards rather than wrapping. On the
   * first, only the words are cut, never the episode number
   */
  .download-line {
    display: flex;
    gap: 0.25em;
    max-width: 100%;
    white-space: nowrap;
  }

  .download-words,
  .download-site {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .download-site {
    font-size: 0.75rem;
    font-weight: 600;
  }

  .download-link:hover,
  .download-link:focus-visible {
    background: var(--sea-blue);
    color: #ffffff;
  }

  /* Without motion, the card simply switches sides */
  @media (prefers-reduced-motion: reduce) {
    .flipper {
      transition: none;
    }
  }

  .cover {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    width: 100%;
    cursor: pointer;
  }

  .title {
    min-height: 2lh;
  }

  .progression {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    /* Keeps the progress row at the bottom when a card is stretched to match its neighbours */
    margin-top: auto;
  }

  /* Sits over the bottom of the cover, above the title and progress (108px together) */
  .front-error {
    position: absolute;
    right: 14px;
    bottom: 116px;
    left: 14px;
    padding: 4px 8px;
    border-radius: 8px;
    background: var(--surface);
    box-shadow: 0 2px 8px rgb(15 61 110 / 0.25);
    text-align: center;
  }

  .progression > span {
    margin-left: auto;
    white-space: nowrap;
  }

  .episode-bar {
    display: flex;
    flex: 1;
    height: 8px;
    overflow: hidden;
    border-radius: 999px;
    /* Not aired yet */
    background: var(--you-blue-pale);
    box-shadow: inset 0 0 0 1px var(--border-subtle);
  }

  .episode-bar .watched {
    background: var(--text-accent);
  }

  /* Aired but not watched yet: the backlog the badge counts */
  .episode-bar .aired {
    background: var(--you-blue);
  }

  /* A white ring and a shadow lift every badge off the cover and the card */
  .card-badge {
    height: var(--badge-height);
    padding: 0 0.85rem;
    border: 2px solid #ffffff;
    font-size: 0.85rem;
    font-weight: 800;
    box-shadow: 0 4px 10px rgb(0 0 0 / 0.2);
    /* Holds the rings that pulse out of it */
    position: relative;
    animation: badge-pop 0.45s ease-out;
  }

  /* The badge to act on stands out most. White on these blues keeps at least 4.5:1 contrast */
  .behind-badge {
    /* Its words are separate flex items, so a word's width apart rather than daisyUI's wide gap */
    gap: 0.3em;
    background: linear-gradient(135deg, #1872b8, var(--sea-blue));
    color: #ffffff;
    box-shadow:
      0 4px 12px rgb(20 95 156 / 0.45),
      0 0 0 3px rgb(73 185 249 / 0.35);
  }

  /*
   * A big backlog sinks into deeper water: navy, with faint diagonal stripes like light through
   * waves. Still blue, so it reads as "a lot to catch up on", not as an alarm
   */
  .behind-badge.deep {
    background:
      repeating-linear-gradient(135deg, rgb(255 255 255 / 0.1) 0 4px, transparent 4px 9px),
      linear-gradient(135deg, var(--sea-blue), var(--navy));
    box-shadow:
      0 4px 12px rgb(15 61 110 / 0.5),
      0 0 0 3px rgb(20 95 156 / 0.35);
  }

  /* The count drops in from above and settles with a small bounce */
  .count {
    display: inline-block;
  }

  .count.ticked {
    animation: count-tick 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  @keyframes count-tick {
    0% {
      translate: 0 -0.6em;
      opacity: 0;
    }
    100% {
      translate: 0 0;
      opacity: 1;
    }
  }

  /* Sea blue on white, outlined in You's sky blue: in the theme, but quieter than "behind" */
  .rewatch-badge {
    border-color: var(--you-blue);
    background: var(--surface);
    color: var(--text-accent);
  }

  /*
   * A sky-blue ring pulses out from the badge and fades, like a gentle heartbeat, while an episode
   * is new. Only the ring grows, so the badge and its text stay sharp. All new badges pulse together,
   * so the grid breathes calmly instead of flickering
   */
  .behind-badge.new-episode::after {
    content: '';
    position: absolute;
    /* Over the badge's white border too */
    inset: -2px;
    border-radius: inherit;
    animation: pulse 2s ease-out 0.5s infinite;
    pointer-events: none;
  }

  @keyframes pulse {
    0% {
      box-shadow: 0 0 0 0 rgb(73 185 249 / 0.7);
    }
    70%,
    100% {
      box-shadow: 0 0 0 10px rgb(73 185 249 / 0);
    }
  }

  /* Catching up splashes: a sky-blue ring bursts out of the caught-up badge, once */
  .splash::after {
    content: '';
    position: absolute;
    inset: -2px;
    border-radius: inherit;
    animation: splash 0.8s ease-out 0.15s both;
    pointer-events: none;
  }

  @keyframes splash {
    0% {
      box-shadow:
        0 0 0 0 rgb(73 185 249 / 0.9),
        0 0 0 0 rgb(73 185 249 / 0.6);
    }
    100% {
      box-shadow:
        0 0 0 18px rgb(73 185 249 / 0),
        0 0 0 30px rgb(73 185 249 / 0);
    }
  }

  @keyframes badge-pop {
    0% {
      scale: 0.4;
      opacity: 0;
    }
    60% {
      scale: 1.15;
      opacity: 1;
    }
    100% {
      scale: 1;
    }
  }

  /* Every cover gets the same 3:4 frame, cropped to fit, whatever the image's own proportions */
  .cover-frame {
    position: relative;
    display: block;
    width: 100%;
    overflow: hidden;
    border-radius: var(--rounded-box, 1rem) var(--rounded-box, 1rem) 0 0;
  }

  img {
    display: block;
    width: 100%;
    aspect-ratio: 3 / 4;
    object-fit: cover;
    transition: filter 300ms ease-out;
  }

  .card-slot:has(:focus-visible) img {
    filter: brightness(1.08);
  }

  /*
   * Mature covers, when the viewer's setting says so: blurred beyond recognition, slightly
   * enlarged so the blurred edges stay outside the frame, and labelled
   */
  .mature img {
    filter: blur(22px);
    scale: 1.1;
  }

  .card-slot:has(:focus-visible) .mature img {
    filter: blur(22px) brightness(1.08);
  }

  /* Centered with auto margins rather than `translate`, which not every browser applies */
  .mature-label {
    position: absolute;
    inset: 0;
    width: max-content;
    height: max-content;
    margin: auto;
    padding: 4px 12px;
    border: 2px solid #ffffff;
    border-radius: 999px;
    background: rgb(15 61 110 / 0.85);
    color: #ffffff;
    font-size: 0.95rem;
    font-weight: 800;
  }
  @media (hover: hover) and (pointer: fine) {
    .card-slot:hover .face {
      box-shadow:
        0 0 0 2px var(--you-blue),
        0 22px 38px -16px var(--card-shadow-deep),
        0 8px 24px -10px rgb(73 185 249 / 0.4);
    }
    .card-slot:hover img {
      filter: brightness(1.08);
    }
    .card-slot:hover .mature img {
      filter: blur(22px) brightness(1.08);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .card-badge {
      animation: none;
    }

    .behind-badge.new-episode::after,
    .splash::after {
      display: none;
    }

    .count.ticked {
      animation: none;
    }

    /* Without motion, the glow appears at once and the card never turns */
    .face,
    img {
      transition: none;
    }
  }
</style>
