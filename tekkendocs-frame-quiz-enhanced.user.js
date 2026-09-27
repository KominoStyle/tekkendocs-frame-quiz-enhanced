// ==UserScript==
// @name         TekkenDocs Frame Quiz Enhanced
// @namespace    https://github.com/KominoStyle
// @version      1.0.1
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

    const SAFE_MODE_STORAGE_KEY =
        'kominoTekkenDocsSafeFrameMode';

    const DAILY_STORAGE_PREFIX =
        'kominoTekkenDocsDailyExactAnswers:v1:';

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

    /*
     * Original TekkenDocs answer buckets.
     *
     * These remain alive in the background because TekkenDocs'
     * own React handlers still control score, streak, Daily
     * Challenge persistence and progression.
     */
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
        localStorage.getItem(
            SAFE_MODE_STORAGE_KEY,
        ) ||
        SAFE_MODES.GROUPED;

    if (!SAFE_MODE_ORDER.includes(safeMode)) {
        safeMode =
            SAFE_MODES.GROUPED;
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

    let currentQuizVideo = null;

    const processedFeedback =
        new WeakSet();

    const slotStyles =
        new WeakMap();

    // ============================================================
    // ROUTES
    // ============================================================

    function isFrameQuizRoute() {
        return /^\/t8\/framequiz\/?$/.test(
            location.pathname,
        );
    }

    function isDailyChallengeRoute() {
        return /^\/t8\/dailychallenge\/?$/.test(
            location.pathname,
        );
    }

    function isSupportedQuizRoute() {
        return (
            isFrameQuizRoute() ||
            isDailyChallengeRoute()
        );
    }

    // ============================================================
    // DAILY CHALLENGE STORAGE
    // ============================================================

    function getLocalDateKey() {
        const date =
            new Date();

        const year =
            date.getFullYear();

        const month =
            String(
                date.getMonth() + 1,
            ).padStart(
                2,
                '0',
            );

        const day =
            String(
                date.getDate(),
            ).padStart(
                2,
                '0',
            );

        return `${year}-${month}-${day}`;
    }

    function getDailyStorageKey() {
        return (
            DAILY_STORAGE_PREFIX +
            getLocalDateKey()
        );
    }

    function getEmptyDailyData() {
        return {
            dateKey:
                getLocalDateKey(),

            answers: {},
        };
    }

    function loadDailyData() {
        try {
            const raw =
                localStorage.getItem(
                    getDailyStorageKey(),
                );

            if (!raw) {
                return getEmptyDailyData();
            }

            const parsed =
                JSON.parse(raw);

            if (
                !parsed ||
                typeof parsed !==
                    'object' ||
                typeof parsed.answers !==
                    'object'
            ) {
                return getEmptyDailyData();
            }

            return parsed;
        } catch {
            return getEmptyDailyData();
        }
    }

    function saveDailyData(data) {
        localStorage.setItem(
            getDailyStorageKey(),
            JSON.stringify(data),
        );
    }

    function clearDailyData() {
        localStorage.removeItem(
            getDailyStorageKey(),
        );
    }

    // ============================================================
    // DAILY QUESTION NUMBER
    // ============================================================

    function getDailyQuestionIndex() {
        if (!isDailyChallengeRoute()) {
            return null;
        }

        const paragraphs =
            Array.from(
                document.querySelectorAll(
                    'p',
                ),
            );

        for (
            const paragraph of paragraphs
        ) {
            const text =
                paragraph.textContent
                    ?.trim();

            if (!text) {
                continue;
            }

            const match =
                text.match(
                    /^Question\s+(\d+)\s*\/\s*10$/i,
                );

            if (!match) {
                continue;
            }

            const number =
                Number(match[1]);

            if (
                Number.isInteger(number) &&
                number >= 1 &&
                number <= 10
            ) {
                return number - 1;
            }
        }

        return null;
    }

    function saveDailyExactAnswer(
        question,
        selectedLabel,
        isCorrect,
    ) {
        if (!isDailyChallengeRoute()) {
            return;
        }

        const data =
            loadDailyData();

        let index =
            getDailyQuestionIndex();

        /*
         * Fallback:
         * if the Question x / 10 text could not be found, try
         * finding an already-known question with this move ID.
         */
        if (index === null) {
            const existing =
                Object.entries(
                    data.answers,
                ).find(
                    ([, answer]) =>
                        answer?.moveId ===
                        question.id,
                );

            if (existing) {
                index =
                    Number(
                        existing[0],
                    );
            }
        }

        /*
         * Last fallback:
         * choose the first unused answer position.
         */
        if (
            index === null ||
            !Number.isInteger(index)
        ) {
            for (
                let candidate = 0;
                candidate < 10;
                candidate += 1
            ) {
                if (
                    !data.answers[
                        String(candidate)
                    ]
                ) {
                    index =
                        candidate;

                    break;
                }
            }
        }

        if (
            index === null ||
            !Number.isInteger(index)
        ) {
            return;
        }

        data.answers[
            String(index)
        ] = {
            moveId:
                question.id,

            command:
                question.move
                    ?.command ||
                '',

            selectedLabel,

            rawBlock:
                question.move
                    ?.block ||
                String(
                    question.blockValue,
                ),

            isCorrect:
                Boolean(
                    isCorrect,
                ),
        };

        saveDailyData(
            data,
        );
    }

    // ============================================================
    // DAILY RESULT REWRITE
    // ============================================================

    function rewriteDailyResults() {
        if (!isDailyChallengeRoute()) {
            return;
        }

        const data =
            loadDailyData();

        for (
            let index = 0;
            index < 10;
            index += 1
        ) {
            const storedAnswer =
                data.answers[
                    String(index)
                ];

            if (!storedAnswer) {
                continue;
            }

            const card =
                document.getElementById(
                    `answer-details-${index + 1}`,
                );

            if (!card) {
                continue;
            }

            /*
             * AnswerDetailsCard currently renders:
             *
             * <p>You picked</p>
             * <p>-12 to -14</p>
             *
             * Replace only the value underneath it.
             */
            const label =
                Array.from(
                    card.querySelectorAll(
                        'p',
                    ),
                ).find(
                    element =>
                        element.textContent
                            ?.trim() ===
                        'You picked',
                );

            if (!label) {
                continue;
            }

            const value =
                label.nextElementSibling;

            if (
                !(value instanceof HTMLElement)
            ) {
                continue;
            }

            if (
                value.textContent
                    ?.trim() ===
                storedAnswer.selectedLabel
            ) {
                continue;
            }

            value.textContent =
                storedAnswer.selectedLabel;
        }
    }

    function isDailyResultView() {
        return Boolean(
            document.getElementById(
                'answer-details-1',
            ),
        );
    }

    // ============================================================
    // SPA NAVIGATION
    // ============================================================

    function handleLocationChange() {
        const newUrl =
            location.href;

        if (
            newUrl ===
            lastKnownUrl
        ) {
            return;
        }

        lastKnownUrl =
            newUrl;

        if (
            isSupportedQuizRoute()
        ) {
            queueProcessPage();

            return;
        }

        cleanup();
    }

    function installNavigationWatcher() {
        if (
            window
                .__ksFrameQuizNavigationWatcher
        ) {
            return;
        }

        window
            .__ksFrameQuizNavigationWatcher =
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
            document.createElement(
                'style',
            );

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
                outline: 2px solid currentColor;
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
    // VIDEO
    // ============================================================

    function findQuizVideo(
        anchorElement,
    ) {
        let element =
            anchorElement;

        while (
            element &&
            element !==
                document.body
        ) {
            const videos =
                element.querySelectorAll(
                    'video',
                );

            if (
                videos.length ===
                1
            ) {
                return videos[0];
            }

            element =
                element.parentElement;
        }

        const videos =
            document.querySelectorAll(
                'video',
            );

        if (
            videos.length ===
            1
        ) {
            return videos[0];
        }

        return null;
    }

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

        video.controls =
            false;

        video.removeAttribute(
            'controls',
        );

        delete video.dataset
            .ksStopAfterCurrentLoop;
    }

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

        video.dataset
            .ksStopAfterCurrentLoop =
            '1';

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

                video.pause();
            },
            {
                once: true,
            },
        );
    }

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

        currentQuizVideo.loop =
            false;

        currentQuizVideo.removeAttribute(
            'loop',
        );

        currentQuizVideo.controls =
            false;

        currentQuizVideo.removeAttribute(
            'controls',
        );
    }

    // ============================================================
    // SAFE FRAME MODES
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
                        value =>
                            value === 0,
                },
                {
                    label: '-1',
                    isCorrect:
                        value =>
                            value === -1,
                },
                {
                    label: '-2',
                    isCorrect:
                        value =>
                            value === -2,
                },
                {
                    label: '-3',
                    isCorrect:
                        value =>
                            value === -3,
                },
                {
                    label: '-4',
                    isCorrect:
                        value =>
                            value === -4,
                },
                {
                    label: '-5',
                    isCorrect:
                        value =>
                            value === -5,
                },
                {
                    label: '-6',
                    isCorrect:
                        value =>
                            value === -6,
                },
                {
                    label: '-7',
                    isCorrect:
                        value =>
                            value === -7,
                },
                {
                    label: '-8',
                    isCorrect:
                        value =>
                            value === -8,
                },
                {
                    label: '-9',
                    isCorrect:
                        value =>
                            value === -9,
                },
            ];
        }

        if (
            safeMode ===
            SAFE_MODES.SPLIT
        ) {
            return [
                {
                    label:
                        '0 to -4',

                    isCorrect:
                        value =>
                            value <= 0 &&
                            value >= -4,
                },

                {
                    label:
                        '-5 to -9',

                    isCorrect:
                        value =>
                            value <= -5 &&
                            value >= -9,
                },
            ];
        }

        return [
            {
                label:
                    '0 to -9',

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
                label:
                    '+1 or more',

                isCorrect:
                    value =>
                        value >= 1,
            },

            ...getSafeOptions(),

            {
                label:
                    '-10',

                isCorrect:
                    value =>
                        value === -10,
            },

            {
                label:
                    '-11',

                isCorrect:
                    value =>
                        value === -11,
            },

            {
                label:
                    '-12',

                isCorrect:
                    value =>
                        value === -12,
            },

            {
                label:
                    '-13',

                isCorrect:
                    value =>
                        value === -13,
            },

            {
                label:
                    '-14',

                isCorrect:
                    value =>
                        value === -14,
            },

            {
                label:
                    '-15',

                isCorrect:
                    value =>
                        value === -15,
            },

            {
                label:
                    '-16 or worse',

                isCorrect:
                    value =>
                        value <= -16,
            },
        ];
    }

    // ============================================================
    // REACT HELPERS
    // ============================================================

    function getReactFiber(
        element,
    ) {
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
            getReactFiber(
                element,
            );

        while (fiber) {
            const question =
                fiber.memoizedProps
                    ?.question;

            if (
                question &&
                typeof question
                    .blockValue ===
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

    function getMoveFromReact(
        element,
    ) {
        let fiber =
            getReactFiber(
                element,
            );

        while (fiber) {
            const move =
                fiber.memoizedProps
                    ?.move;

            if (
                move &&
                typeof move ===
                    'object' &&
                typeof move.command ===
                    'string' &&
                typeof move.block ===
                    'string'
            ) {
                return move;
            }

            fiber =
                fiber.return;
        }

        return null;
    }

    // ============================================================
    // FRAME PARSING
    // ============================================================

    function parseBlockValue(
        block,
    ) {
        const direct =
            Number.parseInt(
                block,
                10,
            );

        if (
            !Number.isNaN(
                direct,
            )
        ) {
            return direct;
        }

        const simplified =
            (
                block.match(
                    /i?[+-]?\d+/,
                )?.[0] ||
                ''
            ).replace(
                /^i/i,
                '',
            );

        const parsed =
            Number.parseInt(
                simplified,
                10,
            );

        return Number.isNaN(
            parsed,
        )
            ? null
            : parsed;
    }

    function getMoveId(
        move,
    ) {
        return (
            move.wavuId ||
            `${move.moveNumber}-${move.command}`
        );
    }

    // ============================================================
    // CURRENT QUESTION
    // ============================================================

    function getQuestionContext(
        anchorElement,
    ) {
        /*
         * Frame Quiz exposes a question prop directly.
         */
        const directQuestion =
            getQuestionFromReact(
                anchorElement,
            );

        if (
            directQuestion &&
            typeof directQuestion
                .blockValue ===
                'number'
        ) {
            return directQuestion;
        }

        /*
         * Daily Challenge renders MoveVideo as a sibling rather
         * than passing question into the answer button tree.
         *
         * Read the current Move from MoveVideo's React props.
         */
        const video =
            findQuizVideo(
                anchorElement,
            );

        if (!video) {
            return null;
        }

        const move =
            getMoveFromReact(
                video,
            );

        if (!move) {
            return null;
        }

        const blockValue =
            parseBlockValue(
                move.block ||
                '',
            );

        if (
            blockValue ===
            null
        ) {
            return null;
        }

        return {
            id:
                getMoveId(
                    move,
                ),

            move,

            blockValue,
        };
    }

    function getQuestionKey(
        question,
    ) {
        return [
            question?.id ||
                '',
            question?.move
                ?.command ||
                '',
            question?.blockValue ??
                '',
            question?.move
                ?.video ||
                '',
        ].join(
            '|',
        );
    }

    // ============================================================
    // FIND NATIVE ANSWERS
    // ============================================================

    function findNativeAnswerGroups() {
        if (
            !isSupportedQuizRoute()
        ) {
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

        const groups =
            [];

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
                    button =>
                        !button,
                )
            ) {
                continue;
            }

            groups.push({
                container,

                buttons,

                slot:
                    container
                        .parentElement,
            });
        }

        return groups;
    }

    function hideNativeAnswerGroups() {
        if (
            !isSupportedQuizRoute()
        ) {
            return [];
        }

        const groups =
            findNativeAnswerGroups();

        for (
            const group of groups
        ) {
            group.container
                .style
                .setProperty(
                    'visibility',
                    'hidden',
                    'important',
                );

            group.container
                .style
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
        if (
            blockValue >=
            1
        ) {
            return '+1 or more';
        }

        if (
            blockValue >=
            -9
        ) {
            return '0 to -9';
        }

        if (
            blockValue >=
            -11
        ) {
            return '-10 to -11';
        }

        if (
            blockValue >=
            -14
        ) {
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
            slotStyles.has(
                slot,
            )
        ) {
            return;
        }

        slotStyles.set(
            slot,
            {
                minHeight:
                    slot.style
                        .minHeight,

                paddingTop:
                    slot.style
                        .paddingTop,
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
            slotStyles.get(
                slot,
            );

        if (!original) {
            return;
        }

        slot.style.minHeight =
            original.minHeight;

        slot.style.paddingTop =
            original.paddingTop;
    }

    // ============================================================
    // COPY NATIVE BUTTON LOOK
    // ============================================================

    function copyNativeButtonLook(
        source,
        target,
    ) {
        const style =
            getComputedStyle(
                source,
            );

        target.style
            .backgroundColor =
            style.backgroundColor;

        target.style
            .backgroundImage =
            style.backgroundImage;

        target.style.color =
            style.color;

        target.style
            .borderTopWidth =
            style.borderTopWidth;

        target.style
            .borderTopStyle =
            style.borderTopStyle;

        target.style
            .borderTopColor =
            style.borderTopColor;

        target.style
            .borderRightWidth =
            style.borderRightWidth;

        target.style
            .borderRightStyle =
            style.borderRightStyle;

        target.style
            .borderRightColor =
            style.borderRightColor;

        target.style
            .borderBottomWidth =
            style.borderBottomWidth;

        target.style
            .borderBottomStyle =
            style.borderBottomStyle;

        target.style
            .borderBottomColor =
            style.borderBottomColor;

        target.style
            .borderLeftWidth =
            style.borderLeftWidth;

        target.style
            .borderLeftStyle =
            style.borderLeftStyle;

        target.style
            .borderLeftColor =
            style.borderLeftColor;

        target.style
            .borderRadius =
            style.borderRadius;

        target.style
            .boxShadow =
            style.boxShadow;

        target.style
            .fontFamily =
            style.fontFamily;

        target.style
            .fontSize =
            style.fontSize;

        target.style
            .fontWeight =
            style.fontWeight;

        target.style
            .lineHeight =
            style.lineHeight;

        target.style
            .letterSpacing =
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

        document.body
            .appendChild(
                portal,
            );

        return portal;
    }

    function positionPortal() {
        if (
            !isSupportedQuizRoute() ||
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
            portal.style
                .visibility =
                'hidden';
        } else {
            portal.style
                .visibility =
                'visible';
        }
    }

    function hidePortal() {
        if (portal) {
            portal.style.display =
                'none';
        }
    }

    // ============================================================
    // SAFE MODE
    // ============================================================

    function cycleSafeMode() {
        if (
            answerInProgress
        ) {
            return;
        }

        const index =
            SAFE_MODE_ORDER
                .indexOf(
                    safeMode,
                );

        safeMode =
            SAFE_MODE_ORDER[
                (
                    index +
                    1
                ) %
                SAFE_MODE_ORDER
                    .length
            ];

        localStorage.setItem(
            SAFE_MODE_STORAGE_KEY,
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

        mode.style
            .borderRadius =
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
    // BUTTON FEEDBACK
    // ============================================================

    function clearSelectedButtonFeedback() {
        if (
            !selectedCustomButton
        ) {
            return;
        }

        selectedCustomButton
            .classList
            .remove(
                'ks-feedback-active',
            );

        selectedCustomButton
            .style
            .removeProperty(
                '--ks-feedback-bg',
            );

        selectedCustomButton
            .style
            .removeProperty(
                '--ks-feedback-border',
            );

        selectedCustomButton
            .style
            .removeProperty(
                '--ks-feedback-accent',
            );

        selectedCustomButton
            .style
            .removeProperty(
                '--ks-feedback-duration',
            );

        selectedCustomButton =
            null;
    }

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
                            element
                                .textContent
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

        selectedCustomButton
            .style
            .setProperty(
                '--ks-feedback-bg',
                bannerStyle
                    .backgroundColor,
            );

        selectedCustomButton
            .style
            .setProperty(
                '--ks-feedback-border',
                bannerStyle
                    .borderTopColor,
            );

        selectedCustomButton
            .style
            .setProperty(
                '--ks-feedback-accent',
                accentColor,
            );

        selectedCustomButton
            .style
            .setProperty(
                '--ks-feedback-duration',
                `${duration}ms`,
            );

        selectedCustomButton
            .classList
            .remove(
                'ks-feedback-active',
            );

        void selectedCustomButton
            .offsetWidth;

        selectedCustomButton
            .classList
            .add(
                'ks-feedback-active',
            );
    }

    // ============================================================
    // ANSWER BUTTON
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
                    getQuestionContext(
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
                 * Daily Challenge remembers the REAL answer choice,
                 * not TekkenDocs' coarse internal bucket.
                 */
                if (
                    isDailyChallengeRoute()
                ) {
                    saveDailyExactAnswer(
                        question,
                        option.label,
                        exactCorrect,
                    );
                }

                /*
                 * Let the current move finish once instead of
                 * starting another loop.
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

                /*
                 * If our precise answer is incorrect, TekkenDocs
                 * must receive an incorrect native bucket too.
                 *
                 * This keeps its score and Daily Challenge result
                 * correct even when two precise answers belong to
                 * the same old coarse category.
                 *
                 * Example:
                 *
                 * Actual: -12
                 * User:   -13
                 *
                 * TekkenDocs considers both "-12 to -14", but our
                 * script deliberately submits another native bucket
                 * so the answer correctly counts as wrong.
                 */
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
                            candidate
                                .textContent
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

                portal?.classList
                    .add(
                        'ks-locked',
                    );

                nativeButton.click();

                /*
                 * Safety unlock.
                 */
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
         * New question.
         */
        enableVideoLoop(
            group.buttons[0],
        );

        clearSelectedButtonFeedback();

        ensurePortal();

        portal.replaceChildren();

        portal.classList
            .remove(
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
                    currentSlot
                        .style
                        .minHeight =
                        `${needed}px`;
                }

                positionPortal();
            },
        );
    }

    // ============================================================
    // FEEDBACK
    // ============================================================

    function findFeedbackButton() {
        if (
            !isSupportedQuizRoute()
        ) {
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
                            button
                                .textContent ||
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

    function processFeedback(
        feedbackButton,
    ) {
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
                feedbackSlot
                    .style
                    .paddingTop =
                    `${portal.offsetHeight + 12}px`;
            }
        }

        /*
         * Must be checked before changing anything inside the
         * feedback card to prevent MutationObserver loops.
         */
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
            feedbackButton
                .textContent ||
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

        /*
         * Replace TekkenDocs' fake coarse answer with the actual
         * precise button the user clicked.
         */
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
                            element
                                .textContent
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
        // Hide visual CONTINUE block
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
                element
                    .textContent
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

            target.style
                .setProperty(
                    'display',
                    'none',
                    'important',
                );
        }

        // --------------------------------------------------------
        // Hide "Show move details" during quick feedback
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

                child.style
                    .setProperty(
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

                /*
                 * The native feedback card itself is TekkenDocs'
                 * Continue button.
                 */
                feedbackButton.click();
            },
            visibleTime,
        );
    }

    // ============================================================
    // DAILY START / RETRY
    // ============================================================

    function handlePageClick(
        event,
    ) {
        if (
            !isDailyChallengeRoute()
        ) {
            return;
        }

        const target =
            event.target;

        if (
            !(target instanceof Element)
        ) {
            return;
        }

        const button =
            target.closest(
                'button',
            );

        if (!button) {
            return;
        }

        const text =
            button
                .textContent
                ?.trim();

        /*
         * A fresh attempt should not reuse the precise answers
         * from a previous attempt on the same day.
         */
        if (
            text ===
                'Start challenge' ||
            text ===
                'Retry'
        ) {
            clearDailyData();

            currentQuestionKey =
                null;

            currentNativeContainer =
                null;

            queueProcessPage();
        }
    }

    // ============================================================
    // RESULT / SETUP UI
    // ============================================================

    function hideQuizUiWithoutClearingDailyData() {
        clearSelectedButtonFeedback();

        if (currentSlot) {
            restoreSlot(
                currentSlot,
            );
        }

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

        currentQuizVideo =
            null;
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

        if (
            currentQuizVideo &&
            document.contains(
                currentQuizVideo,
            )
        ) {
            currentQuizVideo.loop =
                true;

            currentQuizVideo
                .setAttribute(
                    'loop',
                    '',
                );

            delete currentQuizVideo
                .dataset
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

        if (
            !isSupportedQuizRoute()
        ) {
            cleanup();

            return;
        }

        processing =
            true;

        try {
            /*
             * Daily result labels may appear after React finishes
             * rendering, so check them on every relevant mutation.
             */
            if (
                isDailyChallengeRoute()
            ) {
                rewriteDailyResults();
            }

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

            /*
             * Daily Challenge finished:
             * hide our answer UI but keep the stored precise
             * choices so the result cards can display them.
             */
            if (
                isDailyChallengeRoute() &&
                isDailyResultView()
            ) {
                hideQuizUiWithoutClearingDailyData();

                rewriteDailyResults();

                return;
            }

            const group =
                groups[0];

            if (!group) {
                return;
            }

            const question =
                getQuestionContext(
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
        if (
            processQueued
        ) {
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

                if (
                    !isSupportedQuizRoute()
                ) {
                    return;
                }

                hideNativeAnswerGroups();

                enforceStoppedVideoLoop();

                if (
                    isDailyChallengeRoute()
                ) {
                    rewriteDailyResults();
                }

                queueProcessPage();
            },
        );

    // ============================================================
    // F8
    // ============================================================

    function handleKeyDown(
        event,
    ) {
        if (
            !isSupportedQuizRoute()
        ) {
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
    // POSITION
    // ============================================================

    window.addEventListener(
        'resize',
        () => {
            if (
                isSupportedQuizRoute()
            ) {
                positionPortal();
            }
        },
    );

    window.addEventListener(
        'scroll',
        () => {
            if (
                isSupportedQuizRoute()
            ) {
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

    document.addEventListener(
        'click',
        handlePageClick,
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
