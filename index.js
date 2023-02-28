// Collection Utils
const subParagraph = (paragraph, startword, endword) => {
    if (!endword) return paragraph.includes(startword);
    const startIx = paragraph.indexOf(startword);
    if (startIx < 0) return undefined;
    return paragraph.substring(
        startIx + startword.replaceAll("\\", "").length,
        paragraph.indexOf(endword, startIx + startword.replaceAll("\\", "").length)
    );
};
const cartesian = (...a) => a.reduce((a, b) => a.flatMap((d) => b.map((e) => [d, e].flat())));
const range = (start, end, step) => {
    return Array.from(Array.from(Array(Math.ceil((end - start) / step)).keys()), (x) => start + x * step);
};
const partition = (array, n) => (array.length ? [array.splice(0, n)].concat(partition(array, n)) : []);
const shortRandom = () => (Math.random() + 1).toString(36).substring(2);

// Message Utils
const trimPrefix = (m) => m.match(/~m~.*~m~(.*)/)[1];

// Socket context
const _StudyRunner = {
    chart_sess: "cs_" + shortRandom(),
    quote_sess: "qs_" + shortRandom(),
    killflag: false,
    socketInterval: 5000,
    watchDogPeriod: 90000,
    hbMessageLen: 20,
    results: {},
    studiesFinished: 0,
    logger: console,
    startTs: 0,
    studyStartTs: 0,
    waitForReadyState(ready_state) {
        const self = this;
        let interval;
        const isReady = () => self.wss.readyState === ready_state;
        return isReady()
            ? Promise.resolve()
            : new Promise((resolve) => {
                  interval = setInterval(() => isReady() && clearInterval(interval) && resolve(), self.socketInterval);
              });
    },
    sendM(m) {
        if (!m) {
            return;
        }
        const self = this;

        const length = m.replaceAll("\\\\", "\\").length;
        self.logger.debug(`OUT:~m~${length}~m~${m}`);
        self.wss.send(`~m~${length}~m~${m}`);
    },
    stop() {
        this.killflag = true;
        this.wss.close();
        return true;
    },
    getStudyPayload(ix) {
        return (
            this.studies[ix] &&
            this.studies[ix].studyPayload &&
            this.studies[ix].studyPayload.replace(/p":\[("(?:[^"\\]|\\.)*")/, `p":["${this.chart_sess}"`)
        );
    },
    consumeStudy() {
        this.studyStartTs = new Date().getTime();

        const cachedResult =
            this.studyParams[this.studiesFinished] &&
            this.results[JSON.stringify(this.studyParams[this.studiesFinished]).replaceAll('\\"', "")];
        if (cachedResult) {
            //advance to next
            this.studiesFinished++;
            return this.consumeStudy();
        }

        const _consumeStudy = this.getStudyPayload(this.studiesFinished);
        if (_consumeStudy) {
            this.sendM(_consumeStudy);
            this.logger.debug(
                `Study_${this.studiesFinished} Started -  ${
                    this.studies.length - this.studiesFinished - 1
                } remaining -- Duration(s):${(new Date().getTime() - this.studyStartTs) / 1000} Session Time(s):${
                    (new Date().getTime() - this.startTs) / 1000
                }`
            );
        }
    },
    startRunner() {
        const self = this;
        this.startTs = new Date().getTime();
        this.logger.info("Starting Runner");
        return this.studiesFinished < this.studies.length
            ? new Promise((resolve) => self.startSocket(resolve))
            : Promise.resolve(this.studiesFinished);
    },
    startSocket(runResolve) {
        const self = this;

        this.logger.warn("Starting Socket");
        this.wss = new WebSocket(`wss://${socket_host}/socket.io/websocket`);

        this.wss.onopen = () =>
            self
                .waitForReadyState(WebSocket.OPEN)
                .then(() =>
                    self.init_commands.reduce(
                        (p, m) => p.then(() => self.sendM(m)),
                        new Promise((resolve) => setTimeout(resolve, self.socketInterval))
                    )
                )
                .then(() => self.consumeStudy());

        this.wss.onclose = () =>
            self
                .waitForReadyState(WebSocket.CLOSED)
                .then(() => (!self.killflag && self.startSocket(runResolve)) || runResolve(self.studiesFinished));

        this.wss.onmessage = (evt) => {
            const received_msg = evt.data;
            self.logger.debug("IN:" + received_msg);

            // read
            if (subParagraph(received_msg, "study_loading")) {
                self.studyStartTs = new Date().getTime();
            }
            const report = subParagraph(received_msg, 'performance\\":{', "}}");
            if (report && new Date().getTime() - self.studyStartTs < 10000000) {
                self.logger.debug("attempting to parse:" + report);
                var parsedReport = JSON.parse(report.replaceAll("\\", "") + "}}");
                self.logger.debug(JSON.stringify(parsedReport));
                const oldRes =
                    self.results[JSON.stringify(self.studies[self.studiesFinished].paramCombo).replaceAll('\\"', "")];
                self.results[JSON.stringify(self.studies[self.studiesFinished].paramCombo).replaceAll('\\"', "")] =
                    parsedReport;

                self.sendM(`{"m":"remove_study","p":["${this.chart_sess}","st6"]}`);
                self.logger.info(
                    `Study_${self.studiesFinished} Finished - Net profit: ${Math.round(
                        parsedReport.all.netProfitPercent * 100
                    )}% - session progress:${Math.round(
                        (1 - (self.studies.length - self.studiesFinished - 1) / self.studies.length) * 100
                    )}% -- Duration(s):${(new Date().getTime() - self.studyStartTs) / 1000} Session Time(s):${
                        (new Date().getTime() - self.startTs) / 1000
                    } - ETA: ${Math.round(
                        ((1 / (1 - (self.studies.length - self.studiesFinished - 1) / self.studies.length)) *
                            (new Date().getTime() - self.startTs)) /
                            1000 /
                            60
                    )} minutes`
                );
                self.studiesFinished++;
                if (oldRes) {
                    self.studiesFinished--;
                }

                self.studyStartTs = 0; // new Date().getTime() ;
            } else if (
                new Date().getTime() - self.studyStartTs > self.watchDogPeriod &&
                new Date().getTime() - self.studyStartTs < 10000000
            ) {
                self.sendM(`{"m":"remove_study","p":["${this.chart_sess}","st6"]}`);
                self.logger.info(
                    `Study_${self.studiesFinished} Timed out -  ${
                        self.studies.length - self.studiesFinished
                    } remaining -- Duration(s):${(new Date().getTime() - self.studyStartTs) / 1000} Session Time(s):${
                        (new Date().getTime() - self.startTs) / 1000
                    }`
                );
                self.studyStartTs = 0; // new Date().getTime() ;
            }

            // respond
            const received_error = subParagraph(received_msg, "protocol_error");
            if (self.killflag || self.studies.length <= self.studiesFinished || received_error) {
                if (received_error) {
                    self.logger.warn(`Protocol Error`);
                } else {
                    self.killflag = true;
                }
                self.wss.close();
                return;
            }

            if (received_msg.length < self.hbMessageLen) {
                self.sendM(trimPrefix(received_msg));
            }
            if (subParagraph(received_msg, "study_error", "p")) {
                self.sendM(`{"m":"remove_study","p":["${this.chart_sess}","st6"]}`);
                self.logger.info(
                    `Skipping Study_${self.studiesFinished} due to error -  ${
                        self.studies.length - self.studiesFinished
                    } remaining -- Duration(s):${(new Date().getTime() - self.studyStartTs) / 1000} Session Time(s):${
                        (new Date().getTime() - self.startTs) / 1000
                    }`
                );
                self.studiesFinished++;
                self.consumeStudy();
            }
            if (subParagraph(received_msg, "study_deleted")) {
                self.consumeStudy();
            }
        };
    },
};
function StudyRunner(options) {
    const self = Object.create(_StudyRunner);
    const { studies, results, logger, studyParams, chart_symbol, interval } = options;
    self.studies = studies;
    self.results = results;
    self.logger = logger;
    self.killflag = false;
    self.studiesFinished = 0;
    self.studyParams = studyParams;
    self.init_commands = [
        `{"m":"set_auth_token","p":["${auth_token}"]}`,
        `{"m":"chart_create_session","p":["${self.chart_sess}",""]}`,
        `{"m":"quote_create_session","p":["${self.quote_sess}"]}`,
        `{"m":"resolve_symbol","p":["${self.chart_sess}","sds_sym_1","={\\"adjustment\\":\\"splits\\",\\"session\\":\\"regular\\",\\"symbol\\":\\"${chart_symbol}\\"}"]}`,
        `{"m":"create_series","p":["${self.chart_sess}","sds_1","s1","sds_sym_1","${interval}",300,""]}`,
    ];
    return self;
}

const auth_token = "unauthorized_user_token";
const socket_host = "data.tradingview.com"; //'prodata.tradingview.com'

const number_of_runners = 35;

// YOU Must *inspect* a client websocket to find this template for YOUR script
// This will have to be updated any time you update your script source code
// YOU will have manually replace \ with \\ to properly prepare otherwise you will get wrong_data error
// it should look like this `~m~42369~m~{"m":"create_study","p":["cs ..... blah blah ....true,"t":"float"},"in_54":{"v":false,"f":true,"t":"bool"},"__user_pro_plan":{"v":"","f":true,"t":"usertype"},"first_visible_bar_time":{"v":1662634800000,"f":true,"t":"integer"}}]}`
const study_template = `CHANGE_ME`;

// variable template - key should match input order in the study starting count from 0
const variable_template = {
    0: ["true", "false"],
    1: ["true", "false"],
    2: ["true", "false"],
    3: ["true", "false"],
    4: ["true", "false"],
    5: ["true", "false"],
    6: ["true", "false"],
    7: ["true", "false"],
    8: ["true", "false"],
    9: ["true", "false"],
    10: ["true", "false"],
    11: ["true", "false"],
    12: ["true", "false"],
    15: [3],
    18: ['"Hidden"', '"Regular"', '"Regular/Hidden"'],
    19: range(1, 4, 1),
    20: range(20, 50, 10),
};

const analytics = {
    getFeasibleStrats(
        source,
        query = {
            sortCritera: "netProfit",
            filterCriteria: { totalTrades: 15, avgTradePercent: 0.05, sharpeRatio: 0.5, avgBarsInTrade: 20 * 24 },
            sortAgg: "some",
            filtAgg: "some",
            limit: 1000,
        }
    ) {
        const { sortCritera, filterCriteria, sortAgg, filtAgg, limit } = query;

        const result = [];
        let i = 0;
        Object.keys(source[0]).forEach((ix) => {
            if (source[0][ix]) {
                result[i++] = { params: ix, results: Object.keys(source).map((sk) => source[sk][ix]) };
            }
        });
        return result
            .sort((a, b) =>
                Object.keys(source)[sortAgg](
                    (sk) =>
                        a.results[sk] &&
                        b.results[sk] &&
                        b.results[sk].all[sortCritera] - a.results[sk].all[sortCritera]
                )
            )
            .filter((it) =>
                Object.keys(source)[filtAgg](
                    (sk) =>
                        it.results[sk] &&
                        it.results[sk].all.avgBarsInTrade < filterCriteria.avgBarsInTrade &&
                        it.results[sk].all.totalTrades > filterCriteria.totalTrades &&
                        it.results[sk].all.avgTradePercent > filterCriteria.avgTradePercent &&
                        it.results[sk].sharpeRatio > filterCriteria.sharpeRatio
                )
            )
            .slice(0, limit);
    },
};

const _StratManager = {
    runners: [],
    prepareStudies(defaultTempl, varTempl) {
        const self = this;
        self.studyParams = cartesian(...Object.values(varTempl));
        return self.studyParams
            .map((paramCombo) => {
                if (!self.results[0] || !self.results[0][JSON.stringify(paramCombo).replaceAll('\\"', "")]) {
                    let studyPayload = defaultTempl;
                    const setStudyInput = (ix, val) => {
                        studyPayload = studyPayload.replace(
                            new RegExp(`in_${ix}":{"v":((?:[^\\,]|\\.)*)`),
                            `in_${ix}":{"v":${val}`
                        );
                    };
                    Object.keys(varTempl).forEach((key, ix) => setStudyInput(key, paramCombo[ix]));
                    return { studyPayload, paramCombo };
                }
            })
            .filter((study) => study);
    },
    start(optionsList = [{ chart_symbol: "BINANCE:BTCUSD", interval: "60" }]) {
        var self = this;

        return Promise.all(
            partition(self.allstudies, self.allstudies.length / Math.min(self.allstudies.length, self.numRunners)).map(
                (studies, ixs) => {
                    const color = Math.floor(Math.random() * 16777215).toString(16);

                    return optionsList.reduce((p, options, ixo) => {
                        const _logger = {
                            info: (m) =>
                                self.logger.info(
                                    "%c [runner-" + ixs + "-" + Object.values(options).join("-") + "] " + m,
                                    `color: #${color}`
                                ),
                            debug: (m) =>
                                self.logger.debug(
                                    "%c [runner-" + ixs + "-" + Object.values(options).join("-") + "] " + m,
                                    `color: #${color}`
                                ),
                            warn: (m) =>
                                self.logger.log(
                                    "%c [runner-" + ixs + "-" + Object.values(options).join("-") + "] " + m,
                                    `color: #${color}`
                                ),
                        };
                        return p.then(() => {
                            if (!self.results[ixo]) {
                                self.results[ixo] = {};
                            }
                            self.runners[ixs] = new StudyRunner({
                                studies,
                                results: self.results[ixo],
                                logger: _logger,
                                studyParams: self.studyParams,
                                chart_symbol: options.chart_symbol,
                                interval: options.interval,
                            });
                            return self.runners[ixs].startRunner();
                        });
                    }, Promise.resolve());
                }
            )
        );
    },
    stop() {
        this.runners.forEach((sess) => sess.stop());
    },
    getResults() {
        return this.results.flat();
    },
};

function StratManager(variableTemplate, studyTemplate, numRunners = 1, results = window.reports, logger = console) {
    const self = Object.create(_StratManager);

    self.numRunners = numRunners;
    self.results = results;
    self.allstudies = self.prepareStudies(trimPrefix(studyTemplate), variableTemplate);
    self.logger = logger;

    return self;
}

if (!window.reports) {
    window.reports = [];
}

const start = () => {
    const stratManager = new StratManager(
        variable_template,
        study_template,
        number_of_runners,
        window.reports,
        console
    );

    stratManager
        .start([
            { chart_symbol: "BINANCE:BTCUSD", interval: "60" },
            { chart_symbol: "TVC:GOLD", interval: "60" },
        ])
        .then(() => console.log(JSON.stringify(analytics.getFeasibleStrats(stratManager.getResults()))));
    return "Simulation Started!";
};

const stop = () => {
    stratManager.stop();
    return "Simulation Stopped.";
};

start();
