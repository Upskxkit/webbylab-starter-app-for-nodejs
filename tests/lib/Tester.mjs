import FileSystem from 'fs';
import LIVR       from 'livr';
import extraRules from 'livr-extra-rules';
// import fetch              from 'node-fetch';

// import TransportClientWS  from 'mole-rpc-transport-ws/TransportClientWS';
// import MoleClient         from 'mole-rpc/MoleClient';
// import WebSocket          from 'ws';

import initAllModels      from '../../lib/domain-model/initModels.mjs';
import appConfig          from '../../lib/config.cjs';
// import app                from '../../app';
// import rpcApp             from '../../lib/json-rpc/app';
import { Exception } from '../../packages.mjs';
import TestFactory        from './TestFactory.mjs';

const fs = FileSystem.promises;

// This function is needed to make linter alive for current file
// eslint-disable-next-line func-style
const lazyImport = (path) => import(path);

// const WSS_PORT = 12345;

class Tester {
    constructor() {
        const { sequelize } = initAllModels(appConfig['test-db']);

        global.sequelize = sequelize; // TODO find a better way

        this.sequelize = sequelize;
        this.factory = new TestFactory();
        // this.app = app;
        // this.rpcApp = rpcApp;

        // this.moleClient = new MoleClient({
        //     requestTimeout : 1000,
        //     transport      : new TransportClientWS({
        //         wsBuilder : () => new WebSocket(`ws://localhost:${WSS_PORT}`)
        //     })
        // });
    }

    readTestDirs(rootDir) {
        // eslint-disable-next-line no-sync
        const items = FileSystem.readdirSync(rootDir, { withFileTypes: true });
        const dirs = items.filter(f => f.isDirectory()).map(f => f.name);

        return dirs;
    }

    async readTestData(rootDir, dir) {
        const files = (await fs.readdir(`${rootDir}/${dir}`, { withFileTypes: true }))
            .filter(f => f.isFile())
            .map(f => f.name);

        const data = {};

        for (const file of files) {
            const key = file.replace(/\..+$/, '');

            data[key] = await lazyImport(`${rootDir}/${dir}/${file}`);

            // TODO: change. Used for JSON imports and default exports
            if (data[key].default) {
                data[key] = data[key].default;
            }
        }

        return data;
    }

    iterateInTransaction(rootDir, cb, test) {
        const dirs = this.readTestDirs(rootDir);

        let rootData = {};

        test.before(async () => {
            rootData = await this.readTestData(rootDir, '');
        });

        for (const dir of dirs) {
            // eslint-disable-next-line no-loop-func
            test.serial(`${rootDir} ${dir}`, async (t) => {
                try {
                    const data = await this.readTestData(rootDir, dir);

                    await this.sequelize.transaction(async t1 => {
                        global.testTransaction = t1;

                        await cb({ ...rootData, ...data }, t); // eslint-disable-line callback-return
                        // global.withTestTransaction = null;
                        global.testTransaction = null;
                        await t1.rollback();
                    });
                } catch (error) {
                    if (!error.message.match(/rollback/)) {
                        // console.log(error);

                        throw error;
                    }
                }
            });
        }

        test.after(async () => {
            await this.sequelize.close();
        });
    }

    async testService({ serviceClass: Service, input = {}, expected = {}, exception } = {}, t) {
        function serviceRunner() {
            const service = new Service({ context: {} });

            return service.run(input);
        }

        await this._testServiceAbstract({ serviceRunner, expected, exception }, t);
    }

    // async testServiceViaRest({ requestBuilder, input = {}, expected = {} } = {}) {
    //     async function serviceRunner() {
    //         const request = requestBuilder(input);
    //         const apiPrefix = 'http://localhost:8000';
    //         const response = await fetch(`${apiPrefix}${request.url}`, {
    //             method  : request.method,
    //             headers : {
    //                 'Content-Type' : 'application/json'
    //             },
    //             body : JSON.stringify(request.body)
    //         });

    //         console.log(response);

    //         return response.json();
    //     }

    //     await this._testServiceAbstract({ serviceRunner, expected });
    // }

    // async testServiceViaJSONRPC({ rpcMethod, input = {}, expected = {} } = {}) {
    //     const serviceRunner = () => {
    //         return this.moleClient.callMethod(rpcMethod, [ input ]);
    //     };

    //     await this._testServiceAbstract({ serviceRunner, expected });
    // }

    async _testServiceAbstract({ serviceRunner, expected = {}, exception = null } = {}, t) {
        if (exception) {
            const error = await t.throwsAsync(
                serviceRunner,
                { instanceOf: Exception }
            );

            t.deepEqual(error, new Exception(exception));

            return;
        }

        const got = await serviceRunner();
        const validator = new LIVR.Validator(expected);

        validator.registerRules(extraRules);
        validator.prepare();

        const validated = validator.validate(got);

        if (!validator.validate(got)) {
            // eslint-disable-next-line no-undef
            t.deepEqual(validator.getErrors(), {});
        }

        // For strict equality
        delete got.status; // TODO: remove this dirty hack
        // eslint-disable-next-line no-undef
        t.deepEqual(got, validated);
        // assert.deepEqual(got, validated);

        // assert.deepInclude(got.data, expected.data);
    }
}


export default Tester;
