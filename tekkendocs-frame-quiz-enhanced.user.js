// ==UserScript==
// @name         TekkenDocs Frame Quiz Enhanced
// @namespace    https://github.com/KominoStyle
// @version      1.0.0
// @description  Enhances the TekkenDocs Tekken 8 Frame Quiz with precise block-frame answers, configurable safe-frame ranges and automatic progression.
// @namespace    !♥Koͨmͧiͭnͥoͤ Style♥!
// @license      MIT
// @homepageURL  https://github.com/KominoStyle/tekkendocs-frame-quiz-enhanced
// @supportURL   https://github.com/KominoStyle/tekkendocs-frame-quiz-enhanced/issues
// @updateURL    https://raw.githubusercontent.com/KominoStyle/tekkendocs-frame-quiz-enhanced/main/tekkendocs-frame-quiz-enhanced.user.js
// @downloadURL  https://raw.githubusercontent.com/KominoStyle/tekkendocs-frame-quiz-enhanced/main/tekkendocs-frame-quiz-enhanced.user.js
// @match        https://tekkendocs.com/*
// @match        https://www.tekkendocs.com/*
// @run-at       document-idle
// @grant        none
// @sandbox      raw
// @noframes
// ==/UserScript==

(() => {
    'use strict';

    // ============================================================
    // CONFIG
    // ============================================================

    const CORRECT_FEEDBACK_MS = 850;
    const WRONG_FEEDBACK_MS = 1600;

    const STORAGE_KEY =
        'kominoTekkenDocsSafeFrameMode';

    const SAFE_MODES = {
        GROUPED: 'grouped',
        SPLIT: 'split',
        EXACT: 'exact',
    };

    const SAFE_MODE_ORDER = [
        SAFE_MODES.GROUPED,
        SAFE_MODES.SPLIT,
        SAFE_MODES.EXACT,
    ];

    const SAFE_MODE_NAMES = {
        [SAFE_MODES.GROUPED]: 'Grouped',
        [SAFE_MODES.SPLIT]: 'Split',
        [SAFE_MODES.EXACT]: 'Exact',
    };

    const ORIGINAL_LABELS = [
        '+1 or more',
        '0 to -9',
        '-10 to -11',
        '-12 to -14',
        '-15 or more',
    ];

    // ============================================================
    // STATE
    // ============================================================

    let safeMode =
        localStorage.getItem(STORAGE_KEY) ||
        SAFE_MODES.GROUPED;

    if (!SAFE_MODE_ORDER.includes(safeMode)) {
        safeMode = SAFE_MODES.GROUPED;
    }

    let portal = null;

    let currentSlot = null;
    let currentNativeContainer = null;
    let currentQuestionKey = null;

    let answerInProgress = false;

    let selectedCustomLabel = null;
    let selectedCustomButton = null;

    let processing = false;
    let processQueued = false;

    let lastKnownUrl =
        location.href;

    /*
     * Current quiz video.
     *
     * While answering:
     * loop = false
     *
     * On next question:
     * loop = true again
     */
    let currentQuizVideo = null;

    const processedFeedback =
        new WeakSet();

    const slotStyles =
        new WeakMap();

    // ============================================================
    // ROUTE DETECTION
    // ============================================================

    function isFrameQuizRoute() {
        return /^\/t8\/framequiz\/?$/.test(
            location.pathname,
        );
    }

    function handleLocationChange() {
        const newUrl =
            location.href;

        if (newUrl === lastKnownUrl) {
            return;
        }

        lastKnownUrl =
            newUrl;

        if (isFrameQuizRoute()) {
            queueProcessPage();
            return;
        }

        cleanup();
    }

    // ============================================================
    // SPA NAVIGATION WATCHER
    // ============================================================

    function installNavigationWatcher() {
        if (
            window.__ksFrameQuizNavigationWatcher
        ) {
            return;
        }

        window.__ksFrameQuizNavigationWatcher =
            true;

        const originalPushState =
            history.pushState;

        const originalReplaceState =
            history.replaceState;

        history.pushState =
            function (...args) {
                const result =
                    originalPushState.apply(
                        this,
                        args,
                    );

                window.dispatchEvent(
                    new Event(
                        'ks-framequiz-locationchange',
                    ),
                );

                return result;
            };

        history.replaceState =
            function (...args) {
                const result =
                    originalReplaceState.apply(
                        this,
                        args,
                    );

                window.dispatchEvent(
                    new Event(
                        'ks-framequiz-locationchange',
                    ),
                );

                return result;
            };

        window.addEventListener(
            'popstate',
            () => {
                window.dispatchEvent(
                    new Event(
                        'ks-framequiz-locationchange',
                    ),
                );
            },
        );

        window.addEventListener(
            'ks-framequiz-locationchange',
            handleLocationChange,
        );
    }

    // ============================================================
    // CSS
    // ============================================================

    function injectStyles() {
        document
            .getElementById(
                'ks-framequiz-style',
            )
            ?.remove();

        const style =
            document.createElement('style');

        style.id =
            'ks-framequiz-style';

        style.textContent = `
            #ks-framequiz-portal {
                position: fixed;

                z-index: 1000;

                box-sizing: border-box;

                margin: 0;
                padding: 0;

                pointer-events: auto;
            }

            .ks-framequiz-toolbar {
                display: flex;

                align-items: center;
                justify-content: space-between;

                flex-wrap: wrap;

                gap: 8px;

                margin-bottom: 10px;
            }

            .ks-framequiz-toolbar-left {
                display: flex;

                align-items: center;

                flex-wrap: wrap;

                gap: 8px;
            }

            .ks-framequiz-info {
                font-size: 12px;

                opacity: 0.72;
            }

            .ks-framequiz-grid {
                display: grid;

                grid-template-columns:
                    repeat(4, minmax(0, 1fr));

                gap: 8px;

                width: 100%;
            }

            .ks-framequiz-answer {
                width: 100% !important;

                min-width: 0 !important;
                max-width: none !important;

                height: 43px !important;
                min-height: 43px !important;

                padding-left: 8px !important;
                padding-right: 8px !important;

                display: inline-flex !important;

                align-items: center !important;
                justify-content: center !important;

                white-space: nowrap;

                cursor: pointer;

                opacity: 1 !important;

                transition:
                    transform 70ms ease,
                    filter 100ms ease,
                    box-shadow 140ms ease,
                    background-color 140ms ease,
                    border-color 140ms ease,
                    color 140ms ease;
            }

            .ks-framequiz-answer:hover {
                filter: brightness(1.10);
            }

            .ks-framequiz-answer:active {
                transform: scale(0.97);

                filter: brightness(1.18);
            }

            .ks-framequiz-answer:focus-visible {
                outline:
                    2px solid currentColor;

                outline-offset: 2px;
            }

            #ks-framequiz-portal.ks-locked
            .ks-framequiz-answer {
                pointer-events: none;

                opacity: 1 !important;
            }

            #ks-framequiz-portal.ks-locked
            .ks-framequiz-answer:hover {
                filter: none;
            }

            .ks-framequiz-answer.ks-feedback-active {
                background:
                    var(--ks-feedback-bg)
                    !important;

                border-color:
                    var(--ks-feedback-border)
                    !important;

                color:
                    var(--ks-feedback-accent)
                    !important;

                filter:
                    none !important;

                animation:
                    ks-framequiz-pulse
                    var(--ks-feedback-duration)
                    ease-out
                    1;
            }

            @keyframes ks-framequiz-pulse {
                0% {
                    transform: scale(1);

                    box-shadow:
                        0 0 0 0
                        transparent;
                }

                16% {
                    transform: scale(1.035);

                    filter:
                        brightness(1.22);

                    box-shadow:
                        0 0 0 3px
                        color-mix(
                            in srgb,
                            var(--ks-feedback-accent) 35%,
                            transparent
                        ),
                        0 0 19px 3px
                        color-mix(
                            in srgb,
                            var(--ks-feedback-accent) 55%,
                            transparent
                        );
                }

                35% {
                    transform: scale(1);

                    filter:
                        brightness(1.12);

                    box-shadow:
                        0 0 12px 2px
                        color-mix(
                            in srgb,
                            var(--ks-feedback-accent) 38%,
                            transparent
                        );
                }

                58% {
                    transform: scale(1.012);

                    filter:
                        brightness(1.06);

                    box-shadow:
                        0 0 7px 1px
                        color-mix(
                            in srgb,
                            var(--ks-feedback-accent) 25%,
                            transparent
                        );
                }

                100% {
                    transform: scale(1);

                    filter: none;

                    box-shadow:
                        0 0 0 0
                        transparent;
                }
            }

            .ks-framequiz-mode {
                cursor: pointer;

                transition:
                    transform 70ms ease,
                    filter 100ms ease;
            }

            .ks-framequiz-mode:hover {
                filter: brightness(1.10);
            }

            .ks-framequiz-mode:active {
                transform: scale(0.97);
            }

            @media (max-width: 600px) {
                .ks-framequiz-grid {
                    grid-template-columns:
                        repeat(2, minmax(0, 1fr));
                }
            }
        `;

        document.head.appendChild(
            style,
        );
    }

    // ============================================================
    // VIDEO HANDLING
    // ============================================================

    /*
     * Find the video belonging to the current quiz card.
     *
     * We start near the native answer buttons and walk upwards
     * until we find an ancestor containing exactly one video.
     */
    function findQuizVideo(anchorElement) {
        let element =
            anchorElement;

        while (
            element &&
            element !== document.body
        ) {
            const videos =
                element.querySelectorAll(
                    'video',
                );

            if (videos.length === 1) {
                return videos[0];
            }

            element =
                element.parentElement;
        }

        /*
         * Fallback.
         *
         * Frame Quiz normally has only one HTML5 video.
         */
        const videos =
            document.querySelectorAll(
                'video',
            );

        if (videos.length === 1) {
            return videos[0];
        }

        return null;
    }

    /*
     * Called for every new question.
     *
     * The new move should loop normally again while the user
     * is learning / deciding.
     */
    function enableVideoLoop(
        anchorElement,
    ) {
        const video =
            findQuizVideo(
                anchorElement,
            );

        if (!video) {
            currentQuizVideo =
                null;

            return;
        }

        currentQuizVideo =
            video;

        video.loop =
            true;

        video.setAttribute(
            'loop',
            '',
        );

        /*
         * Never introduce native video controls.
         */
        video.controls =
            false;

        video.removeAttribute(
            'controls',
        );

        /*
         * Remove our previous ended marker if the same DOM video
         * element gets reused by ReactPlayer for another move.
         */
        delete video.dataset
            .ksStopAfterCurrentLoop;
    }

    /*
     * Called the moment the user clicks an answer.
     *
     * IMPORTANT:
     *
     * We DO NOT pause.
     *
     * We only disable looping, so the current playback continues
     * naturally until its normal end.
     */
    function finishCurrentVideoThenStop(
        anchorElement,
    ) {
        const video =
            findQuizVideo(
                anchorElement,
            );

        if (!video) {
            return;
        }

        currentQuizVideo =
            video;

        /*
         * Prevent another loop.
         */
        video.loop =
            false;

        video.removeAttribute(
            'loop',
        );

        /*
         * We do not want browser controls or a play overlay.
         */
        video.controls =
            false;

        video.removeAttribute(
            'controls',
        );

        video.dataset
            .ksStopAfterCurrentLoop =
            '1';

        /*
         * If ReactPlayer or another render were to call play()
         * again after the video reaches its end, force it to stay
         * on the final frame while this question is still in its
         * feedback state.
         */
        video.addEventListener(
            'ended',
            () => {
                if (
                    video.dataset
                        .ksStopAfterCurrentLoop !==
                    '1'
                ) {
                    return;
                }

                video.loop =
                    false;

                video.removeAttribute(
                    'loop',
                );

                video.controls =
                    false;

                video.removeAttribute(
                    'controls',
                );

                /*
                 * Native HTML5 video normally already stays on
                 * the last decoded frame after "ended".
                 *
                 * pause() simply makes that explicit.
                 */
                video.pause();
            },
            {
                once: true,
            },
        );
    }

    /*
     * During the feedback phase, make sure nothing accidentally
     * restores loop=true on the OLD video.
     */
    function enforceStoppedVideoLoop() {
        if (
            !answerInProgress ||
            !currentQuizVideo ||
            !document.contains(
                currentQuizVideo,
            )
        ) {
            return;
        }

        if (
            currentQuizVideo.dataset
                .ksStopAfterCurrentLoop !==
            '1'
        ) {
            return;
        }

        if (currentQuizVideo.loop) {
            currentQuizVideo.loop =
                false;
        }

        if (
            currentQuizVideo.hasAttribute(
                'loop',
            )
        ) {
            currentQuizVideo.removeAttribute(
                'loop',
            );
        }

        if (currentQuizVideo.controls) {
            currentQuizVideo.controls =
                false;

            currentQuizVideo.removeAttribute(
                'controls',
            );
        }
    }

    // ============================================================
    // SAFE FRAME OPTIONS
    // ============================================================

    function getSafeOptions() {
        if (
            safeMode ===
            SAFE_MODES.EXACT
        ) {
            return [
                {
                    label: '0',
                    isCorrect:
                        value => value === 0,
                },
                {
                    label: '-1',
                    isCorrect:
                        value => value === -1,
                },
                {
                    label: '-2',
                    isCorrect:
                        value => value === -2,
                },
                {
                    label: '-3',
                    isCorrect:
                        value => value === -3,
                },
                {
                    label: '-4',
                    isCorrect:
                        value => value === -4,
                },
                {
                    label: '-5',
                    isCorrect:
                        value => value === -5,
                },
                {
                    label: '-6',
                    isCorrect:
                        value => value === -6,
                },
                {
                    label: '-7',
                    isCorrect:
                        value => value === -7,
                },
                {
                    label: '-8',
                    isCorrect:
                        value => value === -8,
                },
                {
                    label: '-9',
                    isCorrect:
                        value => value === -9,
                },
            ];
        }

        if (
            safeMode ===
            SAFE_MODES.SPLIT
        ) {
            return [
                {
                    label: '0 to -4',

                    isCorrect:
                        value =>
                            value <= 0 &&
                            value >= -4,
                },
                {
                    label: '-5 to -9',

                    isCorrect:
                        value =>
                            value <= -5 &&
                            value >= -9,
                },
            ];
        }

        return [
            {
                label: '0 to -9',

                isCorrect:
                    value =>
                        value <= 0 &&
                        value >= -9,
            },
        ];
    }

    function getAnswerOptions() {
        return [
            {
                label: '+1 or more',

                isCorrect:
                    value =>
                        value >= 1,
            },

            ...getSafeOptions(),

            {
                label: '-10',

                isCorrect:
                    value =>
                        value === -10,
            },
            {
                label: '-11',

                isCorrect:
                    value =>
                        value === -11,
            },
            {
                label: '-12',

                isCorrect:
                    value =>
                        value === -12,
            },
            {
                label: '-13',

                isCorrect:
                    value =>
                        value === -13,
            },
            {
                label: '-14',

                isCorrect:
                    value =>
                        value === -14,
            },
            {
                label: '-15',

                isCorrect:
                    value =>
                        value === -15,
            },
            {
                label: '-16 or worse',

                isCorrect:
                    value =>
                        value <= -16,
            },
        ];
    }

    // ============================================================
    // REACT QUESTION READING
    // ============================================================

    function getReactFiber(element) {
        if (!element) {
            return null;
        }

        const property =
            Object
                .getOwnPropertyNames(
                    element,
                )
                .find(
                    name =>
                        name.startsWith(
                            '__reactFiber$',
                        ) ||
                        name.startsWith(
                            '__reactInternalInstance$',
                        ),
                );

        return property
            ? element[property]
            : null;
    }

    function getQuestionFromReact(
        element,
    ) {
        let fiber =
            getReactFiber(element);

        while (fiber) {
            const question =
                fiber.memoizedProps
                    ?.question;

            if (
                question &&
                typeof question.blockValue ===
                    'number' &&
                question.move
            ) {
                return question;
            }

            fiber =
                fiber.return;
        }

        return null;
    }

    function getQuestionKey(
        question,
    ) {
        return [
            question?.id || '',
            question?.move?.command || '',
            question?.blockValue ?? '',
            question?.move?.video || '',
        ].join('|');
    }

    // ============================================================
    // FIND ORIGINAL ANSWER BUTTONS
    // ============================================================

    function findNativeAnswerGroups() {
        if (!isFrameQuizRoute()) {
            return [];
        }

        const allButtons =
            Array.from(
                document.querySelectorAll(
                    'button',
                ),
            );

        const containers =
            new Set();

        for (
            const button of
            allButtons
        ) {
            const text =
                button.textContent
                    ?.trim();

            if (
                ORIGINAL_LABELS.includes(
                    text,
                ) &&
                button.parentElement
            ) {
                containers.add(
                    button.parentElement,
                );
            }
        }

        const groups = [];

        for (
            const container of
            containers
        ) {
            const directButtons =
                Array.from(
                    container.children,
                ).filter(
                    child =>
                        child instanceof
                        HTMLButtonElement,
                );

            const buttons =
                ORIGINAL_LABELS.map(
                    label =>
                        directButtons.find(
                            button =>
                                button.textContent
                                    ?.trim() ===
                                label,
                        ),
                );

            if (
                buttons.some(
                    button => !button,
                )
            ) {
                continue;
            }

            groups.push({
                container,
                buttons,
                slot:
                    container.parentElement,
            });
        }

        return groups;
    }

    // ============================================================
    // HIDE ORIGINAL BUTTONS
    // ============================================================

    function hideNativeAnswerGroups() {
        if (!isFrameQuizRoute()) {
            return [];
        }

        const groups =
            findNativeAnswerGroups();

        for (
            const group of groups
        ) {
            group.container.style
                .setProperty(
                    'visibility',
                    'hidden',
                    'important',
                );

            group.container.style
                .setProperty(
                    'pointer-events',
                    'none',
                    'important',
                );
        }

        return groups;
    }

    // ============================================================
    // ORIGINAL TEKKENDOCS BUCKET
    // ============================================================

    function getNativeBucket(
        blockValue,
    ) {
        if (blockValue >= 1) {
            return '+1 or more';
        }

        if (blockValue >= -9) {
            return '0 to -9';
        }

        if (blockValue >= -11) {
            return '-10 to -11';
        }

        if (blockValue >= -14) {
            return '-12 to -14';
        }

        return '-15 or more';
    }

    // ============================================================
    // SLOT STYLE
    // ============================================================

    function rememberSlot(
        slot,
    ) {
        if (
            !slot ||
            slotStyles.has(slot)
        ) {
            return;
        }

        slotStyles.set(
            slot,
            {
                minHeight:
                    slot.style.minHeight,

                paddingTop:
                    slot.style.paddingTop,
            },
        );
    }

    function restoreSlot(
        slot,
    ) {
        if (!slot) {
            return;
        }

        const original =
            slotStyles.get(slot);

        if (!original) {
            return;
        }

        slot.style.minHeight =
            original.minHeight;

        slot.style.paddingTop =
            original.paddingTop;
    }

    // ============================================================
    // COPY NATIVE BUTTON APPEARANCE
    // ============================================================

    function copyNativeButtonLook(
        source,
        target,
    ) {
        const style =
            getComputedStyle(
                source,
            );

        target.style.backgroundColor =
            style.backgroundColor;

        target.style.backgroundImage =
            style.backgroundImage;

        target.style.color =
            style.color;

        target.style.borderTopWidth =
            style.borderTopWidth;

        target.style.borderTopStyle =
            style.borderTopStyle;

        target.style.borderTopColor =
            style.borderTopColor;

        target.style.borderRightWidth =
            style.borderRightWidth;

        target.style.borderRightStyle =
            style.borderRightStyle;

        target.style.borderRightColor =
            style.borderRightColor;

        target.style.borderBottomWidth =
            style.borderBottomWidth;

        target.style.borderBottomStyle =
            style.borderBottomStyle;

        target.style.borderBottomColor =
            style.borderBottomColor;

        target.style.borderLeftWidth =
            style.borderLeftWidth;

        target.style.borderLeftStyle =
            style.borderLeftStyle;

        target.style.borderLeftColor =
            style.borderLeftColor;

        target.style.borderRadius =
            style.borderRadius;

        target.style.boxShadow =
            style.boxShadow;

        target.style.fontFamily =
            style.fontFamily;

        target.style.fontSize =
            style.fontSize;

        target.style.fontWeight =
            style.fontWeight;

        target.style.lineHeight =
            style.lineHeight;

        target.style.letterSpacing =
            style.letterSpacing;
    }

    // ============================================================
    // PORTAL
    // ============================================================

    function ensurePortal() {
        if (
            portal &&
            document.contains(
                portal,
            )
        ) {
            return portal;
        }

        portal =
            document.createElement(
                'div',
            );

        portal.id =
            'ks-framequiz-portal';

        document.body.appendChild(
            portal,
        );

        return portal;
    }

    function positionPortal() {
        if (
            !isFrameQuizRoute() ||
            !portal ||
            !currentSlot ||
            !document.contains(
                currentSlot,
            )
        ) {
            return;
        }

        const rect =
            currentSlot
                .getBoundingClientRect();

        portal.style.left =
            `${rect.left}px`;

        portal.style.top =
            `${rect.top}px`;

        portal.style.width =
            `${rect.width}px`;

        if (
            rect.bottom < 0 ||
            rect.top >
                window.innerHeight
        ) {
            portal.style.visibility =
                'hidden';
        } else {
            portal.style.visibility =
                'visible';
        }
    }

    // ============================================================
    // SAFE MODE SWITCH
    // ============================================================

    function cycleSafeMode() {
        const index =
            SAFE_MODE_ORDER.indexOf(
                safeMode,
            );

        safeMode =
            SAFE_MODE_ORDER[
                (index + 1) %
                SAFE_MODE_ORDER.length
            ];

        localStorage.setItem(
            STORAGE_KEY,
            safeMode,
        );

        currentQuestionKey =
            null;

        queueProcessPage();
    }

    // ============================================================
    // TOOLBAR
    // ============================================================

    function createToolbar(
        nativeExampleButton,
    ) {
        const toolbar =
            document.createElement(
                'div',
            );

        toolbar.className =
            'ks-framequiz-toolbar';

        const left =
            document.createElement(
                'div',
            );

        left.className =
            'ks-framequiz-toolbar-left';

        const info =
            document.createElement(
                'span',
            );

        info.className =
            'ks-framequiz-info';

        info.textContent =
            'Safe-frame detail · F8';

        const auto =
            document.createElement(
                'span',
            );

        auto.className =
            'ks-framequiz-info';

        auto.textContent =
            'Auto-next: ON';

        const mode =
            document.createElement(
                'button',
            );

        mode.type =
            'button';

        mode.className =
            'ks-framequiz-mode';

        mode.textContent =
            `Safe frames: ${SAFE_MODE_NAMES[safeMode]}`;

        copyNativeButtonLook(
            nativeExampleButton,
            mode,
        );

        mode.style.width =
            'auto';

        mode.style.height =
            '30px';

        mode.style.minHeight =
            '30px';

        mode.style.padding =
            '0 12px';

        mode.style.borderRadius =
            '9999px';

        mode.addEventListener(
            'click',
            cycleSafeMode,
        );

        left.appendChild(
            info,
        );

        left.appendChild(
            auto,
        );

        toolbar.appendChild(
            left,
        );

        toolbar.appendChild(
            mode,
        );

        return toolbar;
    }

    // ============================================================
    // CLEAR BUTTON FEEDBACK
    // ============================================================

    function clearSelectedButtonFeedback() {
        if (!selectedCustomButton) {
            return;
        }

        selectedCustomButton.classList.remove(
            'ks-feedback-active',
        );

        selectedCustomButton.style.removeProperty(
            '--ks-feedback-bg',
        );

        selectedCustomButton.style.removeProperty(
            '--ks-feedback-border',
        );

        selectedCustomButton.style.removeProperty(
            '--ks-feedback-accent',
        );

        selectedCustomButton.style.removeProperty(
            '--ks-feedback-duration',
        );

        selectedCustomButton =
            null;
    }

    // ============================================================
    // APPLY BANNER COLORS TO SELECTED BUTTON
    // ============================================================

    function applyButtonFeedback(
        feedbackButton,
        duration,
    ) {
        if (
            !selectedCustomButton ||
            !document.contains(
                selectedCustomButton,
            )
        ) {
            return;
        }

        const bannerStyle =
            getComputedStyle(
                feedbackButton,
            );

        const accentElement =
            Array
                .from(
                    feedbackButton
                        .querySelectorAll(
                            '*',
                        ),
                )
                .find(
                    element => {
                        const text =
                            element.textContent
                                ?.trim();

                        return (
                            text ===
                                'Excellent!' ||
                            text ===
                                'Not quite'
                        );
                    },
                );

        const accentColor =
            accentElement
                ? getComputedStyle(
                    accentElement,
                ).color
                : bannerStyle
                    .borderTopColor;

        selectedCustomButton.style.setProperty(
            '--ks-feedback-bg',
            bannerStyle.backgroundColor,
        );

        selectedCustomButton.style.setProperty(
            '--ks-feedback-border',
            bannerStyle.borderTopColor,
        );

        selectedCustomButton.style.setProperty(
            '--ks-feedback-accent',
            accentColor,
        );

        selectedCustomButton.style.setProperty(
            '--ks-feedback-duration',
            `${duration}ms`,
        );

        selectedCustomButton.classList.remove(
            'ks-feedback-active',
        );

        void selectedCustomButton.offsetWidth;

        selectedCustomButton.classList.add(
            'ks-feedback-active',
        );
    }

    // ============================================================
    // CUSTOM ANSWER BUTTON
    // ============================================================

    function createAnswerButton(
        option,
        nativeButtons,
    ) {
        const button =
            document.createElement(
                'button',
            );

        button.type =
            'button';

        button.className =
            'ks-framequiz-answer';

        button.textContent =
            option.label;

        copyNativeButtonLook(
            nativeButtons[0],
            button,
        );

        button.addEventListener(
            'click',
            () => {
                if (
                    answerInProgress
                ) {
                    return;
                }

                const question =
                    getQuestionFromReact(
                        nativeButtons[0],
                    );

                if (!question) {
                    console.error(
                        '[Komino Quiz] Could not read the current question.',
                    );

                    return;
                }

                const blockValue =
                    question.blockValue;

                const exactCorrect =
                    option.isCorrect(
                        blockValue,
                    );

                selectedCustomLabel =
                    option.label;

                selectedCustomButton =
                    button;

                /*
                 * NEW:
                 *
                 * The moment an answer is selected:
                 *
                 * - current video keeps playing
                 * - loop is disabled
                 * - once it reaches the end, it stays there
                 */
                finishCurrentVideoThenStop(
                    nativeButtons[0],
                );

                const correctBucket =
                    getNativeBucket(
                        blockValue,
                    );

                let bucketToClick =
                    correctBucket;

                if (
                    !exactCorrect
                ) {
                    bucketToClick =
                        ORIGINAL_LABELS.find(
                            label =>
                                label !==
                                correctBucket,
                        );
                }

                const nativeButton =
                    nativeButtons.find(
                        candidate =>
                            candidate.textContent
                                ?.trim() ===
                            bucketToClick,
                    );

                if (!nativeButton) {
                    console.error(
                        '[Komino Quiz] Native answer button could not be found.',
                    );

                    selectedCustomButton =
                        null;

                    return;
                }

                answerInProgress =
                    true;

                portal?.classList.add(
                    'ks-locked',
                );

                nativeButton.click();

                window.setTimeout(
                    () => {
                        if (
                            answerInProgress &&
                            !findFeedbackButton() &&
                            findNativeAnswerGroups()
                                .length > 0
                        ) {
                            answerInProgress =
                                false;

                            clearSelectedButtonFeedback();

                            portal
                                ?.classList
                                .remove(
                                    'ks-locked',
                                );
                        }
                    },
                    3500,
                );
            },
        );

        return button;
    }

    // ============================================================
    // BUILD UI
    // ============================================================

    function buildPortal(
        group,
        question,
    ) {
        const slot =
            group.slot;

        if (!slot) {
            return;
        }

        rememberSlot(
            slot,
        );

        restoreSlot(
            slot,
        );

        const questionKey =
            getQuestionKey(
                question,
            );

        const sameQuestion =
            currentQuestionKey ===
                questionKey &&
            currentNativeContainer ===
                group.container &&
            portal &&
            document.contains(
                portal,
            );

        currentSlot =
            slot;

        if (sameQuestion) {
            positionPortal();

            return;
        }

        /*
         * A genuinely new question has appeared.
         *
         * Its video is allowed to loop again.
         */
        enableVideoLoop(
            group.buttons[0],
        );

        clearSelectedButtonFeedback();

        ensurePortal();

        portal.replaceChildren();

        portal.classList.remove(
            'ks-locked',
        );

        const toolbar =
            createToolbar(
                group.buttons[0],
            );

        const grid =
            document.createElement(
                'div',
            );

        grid.className =
            'ks-framequiz-grid';

        for (
            const option of
            getAnswerOptions()
        ) {
            grid.appendChild(
                createAnswerButton(
                    option,
                    group.buttons,
                ),
            );
        }

        portal.appendChild(
            toolbar,
        );

        portal.appendChild(
            grid,
        );

        portal.style.display =
            'block';

        const slotStyle =
            getComputedStyle(
                slot,
            );

        portal.style.color =
            slotStyle.color;

        portal.style.fontFamily =
            slotStyle.fontFamily;

        currentNativeContainer =
            group.container;

        currentQuestionKey =
            questionKey;

        answerInProgress =
            false;

        selectedCustomLabel =
            null;

        positionPortal();

        requestAnimationFrame(
            () => {
                if (
                    !portal ||
                    !currentSlot
                ) {
                    return;
                }

                const needed =
                    portal.offsetHeight;

                const nativeMinimum =
                    176;

                if (
                    needed >
                    nativeMinimum
                ) {
                    currentSlot.style.minHeight =
                        `${needed}px`;
                }

                positionPortal();
            },
        );
    }

    // ============================================================
    // FIND FEEDBACK
    // ============================================================

    function findFeedbackButton() {
        if (!isFrameQuizRoute()) {
            return null;
        }

        return (
            Array
                .from(
                    document.querySelectorAll(
                        'button',
                    ),
                )
                .find(
                    button => {
                        const text =
                            button.textContent ||
                            '';

                        return (
                            text.includes(
                                'Correct block frames:',
                            ) &&
                            (
                                text.includes(
                                    'Excellent!',
                                ) ||
                                text.includes(
                                    'Not quite',
                                )
                            )
                        );
                    },
                ) ||
            null
        );
    }

    // ============================================================
    // PROCESS FEEDBACK
    // ============================================================

    function processFeedback(
        feedbackButton,
    ) {
        /*
         * Ensure the old video remains non-looping throughout
         * the feedback state.
         */
        enforceStoppedVideoLoop();

        const feedbackRoot =
            feedbackButton
                .parentElement;

        const feedbackSlot =
            feedbackRoot
                ?.parentElement;

        if (feedbackSlot) {
            rememberSlot(
                feedbackSlot,
            );

            currentSlot =
                feedbackSlot;

            positionPortal();

            if (portal) {
                feedbackSlot.style.paddingTop =
                    `${portal.offsetHeight + 12}px`;
            }
        }

        if (
            processedFeedback.has(
                feedbackButton,
            )
        ) {
            return;
        }

        processedFeedback.add(
            feedbackButton,
        );

        const feedbackText =
            feedbackButton.textContent ||
            '';

        const isWrong =
            feedbackText.includes(
                'Not quite',
            );

        const visibleTime =
            isWrong
                ? WRONG_FEEDBACK_MS
                : CORRECT_FEEDBACK_MS;

        applyButtonFeedback(
            feedbackButton,
            visibleTime,
        );

        // --------------------------------------------------------
        // Correct "You picked"
        // --------------------------------------------------------

        if (
            isWrong &&
            selectedCustomLabel
        ) {
            const picked =
                Array
                    .from(
                        feedbackButton
                            .querySelectorAll(
                                'p',
                            ),
                    )
                    .find(
                        element =>
                            element.textContent
                                ?.trim()
                                .startsWith(
                                    'You picked:',
                                ),
                    );

            const wantedText =
                `You picked: ${selectedCustomLabel}`;

            if (
                picked &&
                picked.textContent
                    ?.trim() !==
                    wantedText
            ) {
                picked.textContent =
                    wantedText;
            }
        }

        // --------------------------------------------------------
        // Hide CONTINUE visual
        // --------------------------------------------------------

        const descendants =
            Array.from(
                feedbackButton
                    .querySelectorAll(
                        '*',
                    ),
            );

        for (
            const element of
            descendants
        ) {
            if (
                element.textContent
                    ?.trim() !==
                'CONTINUE'
            ) {
                continue;
            }

            let target =
                element;

            while (
                target.parentElement &&
                target.parentElement !==
                    feedbackButton &&
                target.parentElement
                    .textContent
                    ?.trim() ===
                    'CONTINUE'
            ) {
                target =
                    target.parentElement;
            }

            target.style.setProperty(
                'display',
                'none',
                'important',
            );
        }

        // --------------------------------------------------------
        // Hide Show move details
        // --------------------------------------------------------

        if (feedbackRoot) {
            for (
                const child of
                feedbackRoot.children
            ) {
                if (
                    child ===
                    feedbackButton
                ) {
                    continue;
                }

                child.style.setProperty(
                    'display',
                    'none',
                    'important',
                );
            }
        }

        // --------------------------------------------------------
        // Auto-next
        // --------------------------------------------------------

        window.setTimeout(
            () => {
                if (
                    !document.contains(
                        feedbackButton,
                    )
                ) {
                    return;
                }

                clearSelectedButtonFeedback();

                answerInProgress =
                    false;

                selectedCustomLabel =
                    null;

                currentNativeContainer =
                    null;

                currentQuestionKey =
                    null;

                portal
                    ?.classList
                    .remove(
                        'ks-locked',
                    );

                feedbackButton.click();
            },
            visibleTime,
        );
    }

    // ============================================================
    // CLEANUP
    // ============================================================

    function cleanup() {
        clearSelectedButtonFeedback();

        if (currentSlot) {
            restoreSlot(
                currentSlot,
            );
        }

        /*
         * Restore a normal video state when leaving Frame Quiz.
         */
        if (
            currentQuizVideo &&
            document.contains(
                currentQuizVideo,
            )
        ) {
            currentQuizVideo.loop =
                true;

            currentQuizVideo.setAttribute(
                'loop',
                '',
            );

            delete currentQuizVideo.dataset
                .ksStopAfterCurrentLoop;
        }

        currentQuizVideo =
            null;

        if (portal) {
            portal.style.display =
                'none';
        }

        currentSlot =
            null;

        currentNativeContainer =
            null;

        currentQuestionKey =
            null;

        answerInProgress =
            false;

        selectedCustomLabel =
            null;
    }

    // ============================================================
    // MAIN PROCESS
    // ============================================================

    function processPage() {
        if (processing) {
            return;
        }

        if (!isFrameQuizRoute()) {
            cleanup();

            return;
        }

        processing =
            true;

        try {
            /*
             * If an answer is currently active, keep ensuring
             * that the OLD video cannot loop.
             */
            enforceStoppedVideoLoop();

            const groups =
                hideNativeAnswerGroups();

            const feedback =
                findFeedbackButton();

            if (feedback) {
                processFeedback(
                    feedback,
                );

                return;
            }

            const group =
                groups[0];

            if (!group) {
                return;
            }

            const question =
                getQuestionFromReact(
                    group.buttons[0],
                );

            if (!question) {
                return;
            }

            buildPortal(
                group,
                question,
            );
        } finally {
            processing =
                false;
        }
    }

    function queueProcessPage() {
        if (processQueued) {
            return;
        }

        processQueued =
            true;

        queueMicrotask(
            () => {
                processQueued =
                    false;

                processPage();
            },
        );
    }

    // ============================================================
    // MUTATION OBSERVER
    // ============================================================

    const observer =
        new MutationObserver(
            () => {
                if (
                    location.href !==
                    lastKnownUrl
                ) {
                    handleLocationChange();
                }

                if (!isFrameQuizRoute()) {
                    return;
                }

                hideNativeAnswerGroups();

                /*
                 * Also protect the video from React restoring loop.
                 */
                enforceStoppedVideoLoop();

                queueProcessPage();
            },
        );

    // ============================================================
    // F8
    // ============================================================

    function handleKeyDown(
        event,
    ) {
        if (!isFrameQuizRoute()) {
            return;
        }

        if (
            event.key !==
            'F8'
        ) {
            return;
        }

        const target =
            event.target;

        if (
            target instanceof
                HTMLInputElement ||
            target instanceof
                HTMLTextAreaElement ||
            target instanceof
                HTMLSelectElement ||
            target?.isContentEditable
        ) {
            return;
        }

        event.preventDefault();

        cycleSafeMode();
    }

    // ============================================================
    // POSITION UPDATES
    // ============================================================

    window.addEventListener(
        'resize',
        () => {
            if (isFrameQuizRoute()) {
                positionPortal();
            }
        },
    );

    window.addEventListener(
        'scroll',
        () => {
            if (isFrameQuizRoute()) {
                positionPortal();
            }
        },
        {
            passive: true,
        },
    );

    // ============================================================
    // START
    // ============================================================

    injectStyles();

    installNavigationWatcher();

    document.addEventListener(
        'keydown',
        handleKeyDown,
        true,
    );

    observer.observe(
        document.documentElement,
        {
            childList: true,
            subtree: true,
        },
    );

    processPage();
})();
