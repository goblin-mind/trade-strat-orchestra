// Collection Utils
const CollectionUtils = {
    subParagraph(paragraph, startWord, endWord) {
        const startIdx = paragraph.indexOf(startWord);
        if (startIdx < 0) {
            return undefined;
        }
        if (!endWord) {
            return startIdx > -1;
        }
        const startLen = startWord.replaceAll("\\", "").length;
        const endIdx = paragraph.indexOf(endWord, startIdx + startLen);
        return paragraph.substring(startIdx + startLen, endIdx);
    },
    *cartesianProduct(...arrays) {
        if (arrays.length === 0) {
            yield [];
        } else {
            const [head, ...tail] = arrays;
            for (const h of head) {
                for (const t of CollectionUtils.cartesianProduct(...tail)) {
                    yield [h, ...t];
                }
            }
        }
    },
    createRangeArray(start, end, step = 1) {
        return Array.from({ length: Math.ceil((end - start) / step) }, (_, i) => start + i * step);
    },

    partition(array, n) {
        return array.length ? [array.splice(0, n), ...CollectionUtils.partition(array, n)] : [];
    },
    generateRandomString(length) {
        return Array.from(
            { length },
            () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
        ).join("");
    },
};

// Analytics
const AnalyticsUtils = {
    getFeasibleStrats(
        source,
        query = {
            sortCritera: "netProfit",
            filterCriteria: {
                gt: { netProfitPercent: 0, totalTrades: 15, avgTradePercent: 0.01 },
                lt: { avgBarsInTrade: 20 * 24 },
            },
            sortAgg: "some",
            filtAgg: "every",
            limit: 1000,
        },
        paramsStart = 0,
        paramsEnd = 1
    ) {
        const { sortCritera, filterCriteria, sortAgg, filtAgg, limit } = query;

        const result = [];
        let i = 0;
        Object.keys(source[0]).forEach((ix) => {
            if (source[0][ix]) {
                result[i++] = {
                    params: ix,
                    results: Object.keys(source)
                        .slice(paramsStart, paramsEnd)
                        .map((sk) => source[sk][ix]),
                };
            }
        });
        return result
            .sort((a, b) =>
                sortAgg && sortCritera
                    ? Object.keys(source)
                          .slice(paramsStart, paramsEnd)
                          [sortAgg](
                              (sk) =>
                                  a.results[sk] &&
                                  b.results[sk] &&
                                  b.results[sk].all[sortCritera] - a.results[sk].all[sortCritera]
                          )
                    : true
            )
            .filter((it) =>
                filterCriteria && filtAgg
                    ? Object.keys(source)
                          .slice(paramsStart, paramsEnd)
                          [filtAgg](
                              (sk) =>
                                  it.results[sk] &&
                                  (!filterCriteria.gt ||
                                      Object.keys(filterCriteria.gt).every(
                                          (key) => it.results[sk].all[key] > filterCriteria.gt[key]
                                      )) &&
                                  (!filterCriteria.lt ||
                                      Object.keys(filterCriteria.lt).every(
                                          (key) => it.results[sk].all[key] < filterCriteria.lt[key]
                                      ))
                          )
                    : true
            )
            .slice(0, limit);
    },
    analyzeParams(input) {
        let result = [];
        let paramCounts = Array(input[0].params.length).fill(0);
        let valueCounts = [];

        // Count the occurrences of each value in each position
        for (let i = 0; i < input.length; i++) {
            let params = JSON.parse(input[i].params);
            for (let j = 0; j < params.length; j++) {
                if (!valueCounts[j]) valueCounts[j] = {};
                if (!valueCounts[j][params[j]]) valueCounts[j][params[j]] = 0;
                valueCounts[j][params[j]]++;
                paramCounts[j]++;
            }
        }

        // Calculate the frequency of each value in each position
        for (let i = 0; i < valueCounts.length; i++) {
            let counts = valueCounts[i];
            let freqs = {};
            for (let key in counts) {
                freqs[key] = counts[key] / input.length;
            }
            result.push(freqs);
        }

        return result;
    },
};

// Socket Context
const _SocketMessenger = {
    _waitForReady(isReady) {
        const self = this;
        let interval;
        return isReady()
            ? Promise.resolve()
            : new Promise((resolve, reject) => {
                  self.rejectors.push(reject);
                  setTimeout(() => {
                      interval = setInterval(() => {
                          if (isReady()) {
                              clearInterval(interval);
                              self.rejectors = self.rejectors.filter((rej) => rej != reject);
                              resolve();
                          }
                      }, self.socketInterval);
                  }, self.socketInterval);
              });
    },
    waitForReady() {
        const self = this;
        return this._waitForReady(() => self.isReady);
    },

    socketReceivedgMessage(condmsg) {
        const self = this;
        let handler;
        let m;
        return new Promise((resolve, reject) => {
            self.rejectors.push(reject);
            handler = (evt) => {
                const { data: msg } = evt;
                if (CollectionUtils.subParagraph(msg, condmsg)) {
                    self.rejectors = self.rejectors.filter((rej) => rej != reject);
                    resolve(msg);
                }
                m = msg;
            };
            self.wss.addEventListener("message", handler);
        }).then(() => {
            self.wss.removeEventListener("message", handler);
            return m;
        });
    },
    getMessageBody(message) {
        const [, body] = message.match(/~m~.*~m~(.*)/) || [];
        return body;
    },
    sendM(m) {
        if (!m) {
            return;
        }

        const length = m.replaceAll("\\\\", "\\").length;
        this.logger.debug(`OUT:~m~${length}~m~${m}`);
        this.wss.send(`~m~${length}~m~${m}`);
    },

    openSocket(options) {
        const self = this;
        const { socket_host } = options;
        this.wss = new WebSocket(`wss://${socket_host}/socket.io/websocket`);

        this.wss.onmessage = (evt) => {
            const { data: msg } = evt;
            const { logger, hbMessageLen } = self;
            logger.debug(`IN: ${msg}`);

            const error = CollectionUtils.subParagraph(msg, "protocol_error");
            if (error || self.killflag) {
                if (error) logger.warn("Protocol Error");
                self.wss.close();
                return;
            }

            if (msg.length < hbMessageLen) {
                self.sendM(self.getMessageBody(msg));
            }
        };

        this.killflag = false;
        this.wss.onclose = () => {
            self.isReady = false;
            self.rejectors.forEach((reject) => reject("socketmessenger.socket_dropped"));
            self.rejectors = [];
            if (!self.killflag && self.reconnects < self.maxReconnects) {
                self.reconnects++;
                self.openSocket(options);
            }
        };

        self._waitForReady(() => self.wss.readyState === WebSocket.OPEN)
            .then(() => {
                for (const m of this.init_commands) {
                    self.sendM(m);
                }
            })
            .then(() => self.socketReceivedgMessage("session_id"))
            .then(() => {
                self.isReady = true;
            })
            .catch((e) => {
                if (e !== "socketmessenger.socket_dropped") throw e;
            });
    },

    terminate() {
        this.killflag = true;
        this.wss.close();
    },
};
function SocketMessenger(options) {
    const self = Object.create(_SocketMessenger);
    const { socket_host, logger, init_commands, socketInterval } = options;

    self.logger = logger;
    self.init_commands = init_commands;
    self.socketInterval = socketInterval;
    self.rejectors = [];
    self.maxReconnects = 5;
    self.reconnects = 0;
    self.isReady = false;
    self.openSocket({ socket_host });

    return self;
}

// Runner Context
const _StudyRunner = {
    getStudyPayload(paramCombo) {
        let studyPayload = this.socketMessenger.getMessageBody(this.defaultTempl);
        const setStudyInput = (ix, val) => {
            if (typeof val == "boolean" && !val) {
                return;
            }
            studyPayload = studyPayload.replace(
                new RegExp(`in_${ix}":{"v":((?:[^\\,]|\\.)*)`),
                `in_${ix}":{"v":${val}`
            );
        };
        Object.keys(paramCombo).forEach((key) => setStudyInput(key, paramCombo[key]));
        return studyPayload.replace(/p":\[("(?:[^"\\]|\\.)*")/, `p":["${this.chart_sess}"`); //studyPayload.replace(/p":\[("(?:[^"\\]|\\.)*")/, `p":["${this.chart_sess}"`);
    },
    stop() {
        this.socketMessenger.terminate();
    },
    logStatus(status) {
        const { studiesFinished, startTs, studyStartTs, logger } = this;
        const sessionProgress = (studiesFinished / this.paramCombos.length) * 100;
        const eta = Math.round(((Date.now() - startTs) * 100) / sessionProgress / 1000 / 60);
        logger.info(
            `Study_${studiesFinished} ${status} -- Duration(s):${
                (new Date().getTime() - studyStartTs) / 1000
            } Session Time(s):${(new Date().getTime() - startTs) / 1000} - session progress:${Math.round(
                sessionProgress
            )}% - Series ETA: ${eta} minutes`
        );
    },
    startRunner() {
        const self = this;
        this.startTs = new Date().getTime();
        this.logger.info("Starting Runner");
        return this.studiesFinished < this.paramCombos.length
            ? new Promise((resolve) => self.run(resolve))
            : Promise.resolve(this);
    },
    async run(runResolve) {
        const self = this;
        const { socketMessenger, paramCombos } = this;

        this.logger.info("Starting Run");

        while (this.studiesFinished < paramCombos.length) {
            try {
                const params = paramCombos[this.studiesFinished];
                await socketMessenger.waitForReady();
                const cacheKey = JSON.stringify(params).replaceAll('\\"', "");
                if (this.results[cacheKey]) {
                    this.logStatus(`Skipping Cached Study`);
                    this.studiesFinished++;
                    continue;
                }

                socketMessenger.sendM(this.getStudyPayload(params));

                this.studyStartTs = Date.now();
                await Promise.any([
                    socketMessenger.socketReceivedgMessage("study_error").then(() => {
                        self.logStatus(`Skipping due to error`);
                    }),
                    socketMessenger.socketReceivedgMessage("study_loading").then(() =>
                        Promise.any([
                            self.socketMessenger.socketReceivedgMessage("performance").then((msg) => {
                                const parsedReport = JSON.parse(
                                    CollectionUtils.subParagraph(msg, 'performance\\":{', "}}").replaceAll("\\", "") +
                                        "}}"
                                );
                                self.results[cacheKey] = parsedReport;
                                self.logStatus(
                                    `Finished - Net profit: ${Math.round(parsedReport.all.netProfitPercent * 100)}%`
                                );
                            }),
                            new Promise((resolve, reject) => {
                                setTimeout(() => {
                                    reject("studyrunner.studytimeout");
                                }, self.watchDogPeriod);
                            }),
                        ])
                    ),
                ]);

                socketMessenger.sendM(`{"m":"remove_study","p":["${this.chart_sess}","st6"]}`);
                await socketMessenger.socketReceivedgMessage("study_deleted");
                this.studiesFinished++;
            } catch (e) {
                if (self.killflag) {
                    break;
                } else if (e === "studyrunner.studytimeout") {
                    socketMessenger.sendM(`{"m":"remove_study","p":["${this.chart_sess}","st6"]}`);
                    await socketMessenger.socketReceivedgMessage("study_deleted");
                    continue;
                } else if (
                    e.name === "AggregateError" ||
                    e === "socketmessenger.socket_dropped" ||
                    (e.name === "InvalidStateError" && e.code === 11)
                ) {
                    //retry
                    this.logStatus("Retrying Study");
                    continue;
                } else {
                    throw e;
                }
            }
        }

        this.stop();
        runResolve(this);
    },
};
function StudyRunner(options) {
    const self = Object.create(_StudyRunner);
    const { results, logger, paramCombos, chart_symbol, interval, defaultTempl, auth_token, socket_host } = options;
    (self.chart_sess = "cs_" + CollectionUtils.generateRandomString(10)),
        (self.quote_sess = "qs_" + CollectionUtils.generateRandomString(10)),
        (self.watchDogPeriod = 90000),
        (self.hbMessageLen = 20),
        (self.startTs = 0),
        (self.studyStartTs = 0);
    self.results = results;
    self.logger = logger;
    self.killflag = false;
    self.defaultTempl = defaultTempl;
    self.studiesFinished = 0;
    self.paramCombos = paramCombos;
    self.init_commands = [
        `{"m":"set_auth_token","p":["${auth_token}"]}`,
        `{"m":"chart_create_session","p":["${self.chart_sess}",""]}`,
        `{"m":"quote_create_session","p":["${self.quote_sess}"]}`,
        `{"m":"resolve_symbol","p":["${self.chart_sess}","sds_sym_1","={\\"adjustment\\":\\"splits\\",\\"session\\":\\"regular\\",\\"symbol\\":\\"${chart_symbol}\\"}"]}`,
        `{"m":"create_series","p":["${self.chart_sess}","sds_1","s1","sds_sym_1","${interval}",300,""]}`,
    ];
    self.socketMessenger = new SocketMessenger({
        socket_host,
        logger,
        init_commands: self.init_commands,
        socketInterval: 5000,
    });
    return self;
}

// Simulation Context
const _SimulationManager = {
    start(seriesDefs = [{ chart_symbol: "BINANCE:BTCUSD", interval: "60" }]) {
        var self = this;
        const allParamCombos = [...CollectionUtils.cartesianProduct(...Object.values(self.variableTemplate))];
        return Promise.all(
            CollectionUtils.partition(
                allParamCombos,
                allParamCombos.length / Math.min(allParamCombos.length, self.numRunners)
            ).map((paramCombos, ixs) => {
                const color = Math.floor(Math.random() * 16777215).toString(16);

                return seriesDefs.reduce((p, seriesDef, ixo) => {
                    if (!seriesDef) {
                        return Promise.resolve();
                    }
                    const _logger = {};
                    ["info", "debug", "warn"].forEach((fk) => {
                        _logger[fk] = (m) => {
                            self.logger[fk](
                                "%c [runner-" + ixs + "-" + Object.values(seriesDef).join("-") + "] " + m,
                                `color: #${color}`
                            );
                        };
                    });

                    return p.then(() => {
                        if (!self.results[ixo]) {
                            self.results[ixo] = {};
                        }
                        self.runners[ixs] = new StudyRunner({
                            results: self.results[ixo],
                            logger: _logger,
                            paramCombos: paramCombos,
                            chart_symbol: seriesDef.chart_symbol,
                            interval: seriesDef.interval,
                            defaultTempl: self.studyTemplate,
                            socket_host: self.socket_host,
                            auth_token: self.auth_token,
                        });
                        return self.runners[ixs].startRunner();
                    });
                }, Promise.resolve());
            })
        ).then(() => self);
    },
    stop() {
        this.runners.forEach((runner) => runner.stop());
    },
    getResults() {
        return this.results.flat();
    },
};

function SimulationManager(
    options = { variableTemplate: [], studyTemplate: "", numRunners: 1, results: window.reports, logger: console }
) {
    const self = Object.create(_SimulationManager);
    const { auth_token, socket_host, variableTemplate, studyTemplate, results, numRunners, logger } = options;

    self.numRunners = numRunners;
    self.results = results;
    self.studyTemplate = studyTemplate;
    self.variableTemplate = variableTemplate;
    self.logger = logger;
    self.auth_token = auth_token;
    self.socket_host = socket_host;
    self.runners = [];

    return self;
}

// Application context
const start = () => {
    const auth_token = "unauthorized_user_token";
    // if authorized to pro user - you can use 'prodata.tradingview.com' for running longer strats
    const socket_host = "data.tradingview.com"; 

    const numRunners = 15;
    
    // Provide a socket message describing your pinescript and features here
    // use network inspector to retrieve that message
    // note: update any time you update your pinescript
    // note: you may have to replace \ with \\ to properly prepare otherwise you will get 'wrong_data' error
    // example: it should look like this `~m~10436~m~{"m":"create_study" ...}`
    const studyTemplate = `CHANGE_ME`
    // variable template - key should match input order in the study starting count from 0
    const variableTemplate = {
        0: ["true"],
        1: ["false"],
        2: ["false"],
        3: ["false"],
        4: ["false"],
        5: ["false"],
        6: ["false"],
        7: ["false"],
        8: ["false"],
        9: ["false"],
        10: ["false"],
        11: ["false"],
        12: ["false"],
        13: [false],
        14: [false],
        15: [3],
        16: [false],
        17: [false],
        18: ['"Hidden"', '"Regular"', '"Regular/Hidden"'],
        19: [1],
        20: [30],
        21: CollectionUtils.createRangeArray(4, 20, 2),
        22: CollectionUtils.createRangeArray(16, 60, 3),
    };

    if (!window.reports) {
        window.reports = [];
    }

    window.simulationManager = new SimulationManager({
        variableTemplate,
        studyTemplate,
        numRunners,
        results: window.reports,
        logger: console,
        socket_host,
        auth_token,
    });

    return window.simulationManager
        .start([
            { chart_symbol: "BINANCE:BTCUSD", interval: "240" },
            { chart_symbol: "BINANCE:BTCUSDT", interval: "240" },
        ])
        .then((sm) => {
            window.topRuns = AnalyticsUtils.getFeasibleStrats(sm.getResults());
            if (window.topRuns.length) {
                window.topParams = AnalyticsUtils.analyzeParams(window.topRuns);
            }
        });
};

const stop = () => {
    return window.simulationManager.stop();
};

start().then(() => console.log(JSON.stringify(AnalyticsUtils.getFeasibleStrats(simulationManager.getResults()))));
