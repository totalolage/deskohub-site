# Changelog

## [1.30.0](https://github.com/totalolage/deskohub-site/compare/dhw-v1.29.0...dhw-v1.30.0) (2026-10-30)


### Features

* **dhw:** show the early-setup start of meeting-room reservations ([f015d85](https://github.com/totalolage/deskohub-site/commit/f015d85fd1a1a0cfc5e5fa9b6e1c8ebc9efdfa64))

## [1.29.0](https://github.com/totalolage/deskohub-site/compare/dhw-v1.28.0...dhw-v1.29.0) (2026-10-27)


### Features

* **admin:** add reservation activity calendar ([706b7ba](https://github.com/totalolage/deskohub-site/commit/706b7ba950870b4cb7498d5a5bbdb572dc4fd6fa))

## [1.28.0](https://github.com/totalolage/deskohub-site/compare/dhw-v1.27.0...dhw-v1.28.0) (2026-10-25)


### Features

* **dhw:** warn when the hourly reservation reconcile stalls ([39a999c](https://github.com/totalolage/deskohub-site/commit/39a999cb7405e8560b38f87fe9f2bdb562265ae7))
* **dhw:** warn when the hourly reservation reconcile stalls ([ead84a5](https://github.com/totalolage/deskohub-site/commit/ead84a5c78f8a213a6930fe5590275de621a63c6))

## [1.27.0](https://github.com/totalolage/deskohub-site/compare/dhw-v1.26.0...dhw-v1.27.0) (2026-10-24)


### Features

* **account:** password sign-in and a reservation sandbox for app-directory reviewers ([409ac4e](https://github.com/totalolage/deskohub-site/commit/409ac4e2f3e9349c600d9915c3032a8ab444ba81))
* **dhw:** print run contacts and skip reasons; filter runs by skip reason ([e2b9436](https://github.com/totalolage/deskohub-site/commit/e2b943623dccea726df6107dd372d72ebeee68d0))
* **workspace:** automation flow builder and run log ([dc4a915](https://github.com/totalolage/deskohub-site/commit/dc4a915870002333045015319e7aef3ec041196c))
* **workspace:** serve the administration to administrators' AI agents as MCP tools ([024d815](https://github.com/totalolage/deskohub-site/commit/024d815abd37bdd56ab9537b029946ab5d3889c6))

## [1.26.0](https://github.com/totalolage/deskohub-site/compare/dhw-v1.25.0...dhw-v1.26.0) (2026-10-22)


### Features

* **workspace-admin-api:** move the remaining admin UI operations into the administration API ([69f4970](https://github.com/totalolage/deskohub-site/commit/69f4970cb27025b21d7d612175b9807278d4d25c))

## [1.25.0](https://github.com/totalolage/deskohub-site/compare/dhw-v1.24.0...dhw-v1.25.0) (2026-10-22)


### Features

* **dhw:** decode invoices issued through an AI assistant ([436be91](https://github.com/totalolage/deskohub-site/commit/436be9169870c4c02e7c246deb9cba056c2db997))
* **dhw:** name the destructive operation each confirmation guards ([c3a434e](https://github.com/totalolage/deskohub-site/commit/c3a434e3c7c1611dca34b9e64b81ae3742afb9ee))
* **workspace-admin-api:** annotate administration operations and authenticate a channel-neutral caller ([d6dd6be](https://github.com/totalolage/deskohub-site/commit/d6dd6be1161dbd1313860f038aec154b1fad02fb))

## [1.24.0](https://github.com/totalolage/deskohub-site/compare/dhw-v1.23.0...dhw-v1.24.0) (2026-10-22)


### Features

* **workspace:** automation engine, lifecycle, operations port and dhw automations ([80b177a](https://github.com/totalolage/deskohub-site/commit/80b177a2a763bc2879f6011891f553b3057a2afc))


### Bug Fixes

* **dhw:** keep PR binaries off the production default ([5222b75](https://github.com/totalolage/deskohub-site/commit/5222b7504dd18ffc60926a80fae01d978b2bef7e))
* **dhw:** make the release build an explicit opt-in ([6b57a39](https://github.com/totalolage/deskohub-site/commit/6b57a3918b7f88f60e57e0c6b6f2ede968cf8197))
* **email-campaigns:** date account creation by the account, gate automations on dhw 1.24.0 ([42ad0d2](https://github.com/totalolage/deskohub-site/commit/42ad0d2037db97defcdbcc95ee7640c75efc34bd))
* **workspace:** mark a retried fulfillment failure as undated in replays ([00d517d](https://github.com/totalolage/deskohub-site/commit/00d517d22a21525f5aff84e4226517ef53dbfaf9))
* **workspace:** name Igloohome access by grant, not reservation ([7a2a058](https://github.com/totalolage/deskohub-site/commit/7a2a058a2f36ace6f0868fdd9057a308f3fc8d45)), closes [#780](https://github.com/totalolage/deskohub-site/issues/780)
* **workspace:** replay account creations and reservation statuses as of the event ([294daae](https://github.com/totalolage/deskohub-site/commit/294daae6f95bb354f2ba7d1888d55734c72f3c34))

## [1.23.0](https://github.com/totalolage/deskohub-site/compare/dhw-v1.22.0...dhw-v1.23.0) (2026-10-20)


### Features

* **account:** fold customer links into customer accounts, enforce authors ([#682](https://github.com/totalolage/deskohub-site/issues/682) release B) ([75603b6](https://github.com/totalolage/deskohub-site/commit/75603b67828ea5a2cb66e21aee1fa831c69787b6))

## [1.22.0](https://github.com/totalolage/deskohub-site/compare/dhw-v1.21.0...dhw-v1.22.0) (2026-10-20)


### Features

* **account:** link column, eager customer accounts and account backfill ([#682](https://github.com/totalolage/deskohub-site/issues/682) release A) ([c763766](https://github.com/totalolage/deskohub-site/commit/c7637666798d73dd21000931dd2902a67d6d2c97))
* **dhw:** add accounts backfill command ([6e76dbc](https://github.com/totalolage/deskohub-site/commit/6e76dbc65fc1f6363fd19b54f50f6a2e90e1716a))
* **dhw:** label the account backfill's deleted-account step ([15776e2](https://github.com/totalolage/deskohub-site/commit/15776e2e8ce6c925ac343b02d403ea0ffaa1a2ae))

## [1.21.0](https://github.com/totalolage/deskohub-site/compare/dhw-v1.20.0...dhw-v1.21.0) (2026-10-19)


### Features

* **workspace:** let saved audiences count one campaign's emails, first visits and "any time so far" ([194a13f](https://github.com/totalolage/deskohub-site/commit/194a13fc965b65485e807a1d01f7ff37f76bb0f0))

## [1.20.0](https://github.com/totalolage/deskohub-site/compare/dhw-v1.19.0...dhw-v1.20.0) (2026-10-19)


### Features

* **dhw:** decode upcoming audience attributes ([1a7e3c5](https://github.com/totalolage/deskohub-site/commit/1a7e3c5e9e274469acb8db8345ef191db10dc34d))
* **dhw:** send client version ([a138e31](https://github.com/totalolage/deskohub-site/commit/a138e313727940dc7777ea98918aa9d28a88bdee))
* **email-campaigns:** calendar expressions, trigger periods and campaign-scoped email counts (readers) ([6c3e43c](https://github.com/totalolage/deskohub-site/commit/6c3e43c1377e734bdb2d1312275e18d9fdea3447))

## [1.19.0](https://github.com/totalolage/deskohub-site/compare/dhw-v1.18.0...dhw-v1.19.0) (2026-10-19)


### Features

* **administration:** show who booked a reservation for someone else ([0b0a9f2](https://github.com/totalolage/deskohub-site/commit/0b0a9f2bc8d2535db00e4ecca872d7ba15a97320))
* **dhw:** show who booked a reservation for someone else ([af2c28a](https://github.com/totalolage/deskohub-site/commit/af2c28ad4b388f967a096eb2c3643179705c203a))
* **workspace:** author-aware status access, emails, history and admin ([6964543](https://github.com/totalolage/deskohub-site/commit/6964543aba1c661b63bc331b5df9916c876ccdd4))

## [1.18.0](https://github.com/totalolage/deskohub-site/compare/dhw-v1.17.0...dhw-v1.18.0) (2026-10-17)


### Features

* **admin:** sign administrators in with their accounts and remove Basic auth ([cfb8afa](https://github.com/totalolage/deskohub-site/commit/cfb8afab11ec7347bc886a84bde129b9002a5935))
* **dhw:** CLI sessions follow the approving administrator account ([30b4a21](https://github.com/totalolage/deskohub-site/commit/30b4a21f57c179ae0b29cb40e501723c835f364b))


### Bug Fixes

* **admin:** close dot-segment return redirects and keep released dhw sessions readable ([9f8a9f2](https://github.com/totalolage/deskohub-site/commit/9f8a9f2ae59169e72967eb94ecf0808784d73ae1))

## [1.17.0](https://github.com/totalolage/deskohub-site/compare/dhw-v1.16.0...dhw-v1.17.0) (2026-10-16)


### Features

* **dhw:** grant administrator roles and backfill legacy administrators ([8873d2a](https://github.com/totalolage/deskohub-site/commit/8873d2a067a5bfab617cd6b80cd0e1d49c808a35))
* **dhw:** grant administrator roles and backfill legacy administrators ([3cc3064](https://github.com/totalolage/deskohub-site/commit/3cc306486ae4919196f866267e5c707ef9c7378c))

## [1.16.0](https://github.com/totalolage/deskohub-site/compare/dhw-v1.15.0...dhw-v1.16.0) (2026-10-15)


### Features

* **dhw:** backfill reservation product details from Dotypos ([d046899](https://github.com/totalolage/deskohub-site/commit/d046899c6f6e6655f2df675c271d287f513094ff))
* **workspace:** attribute-catalogue audience filters with counts, date periods and product filters ([4cfa877](https://github.com/totalolage/deskohub-site/commit/4cfa8774949e85c82a9f449d659888028ad13b0a))

## [1.15.0](https://github.com/totalolage/deskohub-site/compare/dhw-v1.14.1...dhw-v1.15.0) (2026-10-15)


### Features

* **dhw:** align campaign commands with the final send API ([d8ec008](https://github.com/totalolage/deskohub-site/commit/d8ec0081f05c26ec524e3931d860d4884a4c8f81))
* **dhw:** manage and send email campaigns ([47714c8](https://github.com/totalolage/deskohub-site/commit/47714c85d1c901056c052dcaae8e91f0c442da93))
* **workspace:** admin email campaigns with audiences, templates and composer ([2035c0d](https://github.com/totalolage/deskohub-site/commit/2035c0d7e950339b8966d6fabc68280653523138))


### Bug Fixes

* **dhw:** keep every campaign endpoint's declared errors ([652d311](https://github.com/totalolage/deskohub-site/commit/652d311abe3a0f61c02616ed617c16a66b57d3c7))

## [1.14.1](https://github.com/totalolage/deskohub-site/compare/dhw-v1.14.0...dhw-v1.14.1) (2026-10-14)


### Bug Fixes

* **dhw:** remove redundant and trivially true tests ([817f1e9](https://github.com/totalolage/deskohub-site/commit/817f1e9d577c856784a8f3d29f5a9f02c74e1e7a))
* **dhw:** remove redundant and trivially true tests ([4593fa6](https://github.com/totalolage/deskohub-site/commit/4593fa63538cee5fb3129086782cb5ba00ed58c1))

## [1.14.0](https://github.com/totalolage/deskohub-site/compare/dhw-v1.13.0...dhw-v1.14.0) (2026-10-14)


### Features

* **discounts:** gate new cowork tier targets behind a release flag ([23e92d8](https://github.com/totalolage/deskohub-site/commit/23e92d8a4b7d2dd73841055ffd0d557488b98c78))


### Bug Fixes

* **dhw:** explain that new cowork tier targets need the release flag ([5548286](https://github.com/totalolage/deskohub-site/commit/5548286e5725f60ec3f26024c889be4cd81084de))


### Performance Improvements

* **e2e:** pool checkout cases and drop serial E2E tails ([6de60e0](https://github.com/totalolage/deskohub-site/commit/6de60e06aacba4cdb7d0aa57d88e517809af6ae2))

## [1.13.0](https://github.com/totalolage/deskohub-site/compare/dhw-v1.12.0...dhw-v1.13.0) (2026-10-12)


### Features

* **email:** route test mail by EMAIL_TEST_DOMAIN ([34353e6](https://github.com/totalolage/deskohub-site/commit/34353e6d5639abe04146d97982584762197aba27))


### Bug Fixes

* **dhw:** build test addresses without an env preload ([671cc6c](https://github.com/totalolage/deskohub-site/commit/671cc6cdd7d3861e91586c7ac0dd491a28a8a185))
* **email:** route Workspace mail by test domain instead of EMAIL_PROVIDER ([1a813b8](https://github.com/totalolage/deskohub-site/commit/1a813b8292e0389b9916c4e86c620c7afe7f2d40))


### Performance Improvements

* **ci:** shorten Workspace CI and E2E, audit test layering, fix refund claim limit ([157db66](https://github.com/totalolage/deskohub-site/commit/157db662aa075377dd1df95995bc488f92523028))

## [1.12.0](https://github.com/totalolage/deskohub-site/compare/dhw-v1.11.1...dhw-v1.12.0) (2026-10-10)


### Features

* **dhw:** filter reservations needing a refund ([d56707c](https://github.com/totalolage/deskohub-site/commit/d56707c7c03eef464a3c23bf4680a95c2d52b047))
* **dhw:** let administrators choose CLI session expiry ([22a8fd1](https://github.com/totalolage/deskohub-site/commit/22a8fd1158e7081cf1af1cdeace6d6ba923ac982))
* **dhw:** let administrators choose CLI session expiry ([c454b21](https://github.com/totalolage/deskohub-site/commit/c454b21f62af218ab5ab572a7385327fdd3de5fd))

## [1.11.1](https://github.com/totalolage/deskohub-site/compare/dhw-v1.11.0...dhw-v1.11.1) (2026-09-25)


### Bug Fixes

* **dhw:** adopt official TypeScript 7/6 side-by-side toolchain ([dd75b30](https://github.com/totalolage/deskohub-site/commit/dd75b30ffca9128f9c7a91c692a95108d17cb36e))
* **dhw:** resolve Effect plugin diagnostics surfaced by tsgo ([89fba82](https://github.com/totalolage/deskohub-site/commit/89fba8288cc63f4e5058783286068e1380264548))

## [1.11.0](https://github.com/totalolage/deskohub-site/compare/dhw-v1.10.0...dhw-v1.11.0) (2026-09-04)


### Features

* **workspace:** administer standalone access codes ([d0caa15](https://github.com/totalolage/deskohub-site/commit/d0caa15f31dc6393187ef08f1c49598c4ee5eb1c))
* **workspace:** administer standalone access codes ([4aab08d](https://github.com/totalolage/deskohub-site/commit/4aab08d5b96152356f44fbfce4aa104068a89d3f))


### Bug Fixes

* **dhw:** confirm access code cleanup target ([74a005a](https://github.com/totalolage/deskohub-site/commit/74a005a37356859a376f9d7caae6dec6b947591a))
* **dhw:** preserve access code attempts ([637f83e](https://github.com/totalolage/deskohub-site/commit/637f83e6fa7bc39afdf1f4b130791150988fc2a9))
* **workspace:** protect one-time access code delivery ([76b7f70](https://github.com/totalolage/deskohub-site/commit/76b7f708952167a6ab5cbbc7528e20c0e1ec23ab))
* **workspace:** require safe access code retries ([8399463](https://github.com/totalolage/deskohub-site/commit/8399463c182494eb2b58c728981bafae1bdf3735))

## [1.10.0](https://github.com/totalolage/deskohub-site/compare/dhw-v1.9.1...dhw-v1.10.0) (2026-08-27)


### Features

* **dhw:** expose reservation purpose and invoice links ([611533d](https://github.com/totalolage/deskohub-site/commit/611533d7dde70f654e691d96758724d16b032af2))
* **dhw:** force-cancel pending reservations ([f4fc74a](https://github.com/totalolage/deskohub-site/commit/f4fc74af4826e55db0e705dec28a6d5321e59bfe))
* **dhw:** force-cancel pending reservations ([b034dfc](https://github.com/totalolage/deskohub-site/commit/b034dfc9241f83d33ba88c39eeeafd893b7659f8))


### Bug Fixes

* **workspace:** avoid unused invoice lookup ([8da8a70](https://github.com/totalolage/deskohub-site/commit/8da8a70fab6384b296cb233d574bb1d9bc502ea0))

## [1.9.1](https://github.com/totalolage/deskohub-site/compare/dhw-v1.9.0...dhw-v1.9.1) (2026-08-25)


### Bug Fixes

* **dhw:** expose completed reservation counts ([7dd93e5](https://github.com/totalolage/deskohub-site/commit/7dd93e5cc1bc474eebf834a1370ad3761b6c471b))

## [1.9.0](https://github.com/totalolage/deskohub-site/compare/dhw-v1.8.2...dhw-v1.9.0) (2026-08-20)


### Features

* **dhw:** add ad-hoc invoice administration ([1e67fdb](https://github.com/totalolage/deskohub-site/commit/1e67fdbcbb25dfe9efe1b1c239426a25e503ffc7))
* **dhw:** support paid ad-hoc invoices ([840260a](https://github.com/totalolage/deskohub-site/commit/840260ac0a5b360197f847e326a6afb2fa0a67e9))


### Bug Fixes

* **dhw:** preserve invoice ids across restarts ([9dcf594](https://github.com/totalolage/deskohub-site/commit/9dcf5942740897394359bd8f839a49d937a9a4db))
* **dhw:** retry invoices through claim recovery ([01ef211](https://github.com/totalolage/deskohub-site/commit/01ef2116e0bb8e9038f22dab311db697cf27c398))

## [1.8.2](https://github.com/totalolage/deskohub-site/compare/dhw-v1.8.1...dhw-v1.8.2) (2026-08-14)


### Bug Fixes

* **dhw:** align default and live layer naming ([c09a411](https://github.com/totalolage/deskohub-site/commit/c09a4110769574d90274ba5ee6543d94eb62bbeb))

## [1.8.1](https://github.com/totalolage/deskohub-site/compare/dhw-v1.8.0...dhw-v1.8.1) (2026-08-14)


### Bug Fixes

* **dhw:** decode pre-voucher customer responses ([ba4930e](https://github.com/totalolage/deskohub-site/commit/ba4930e3776e22d4c7053fd2507d76c10c26eaaf))
* **dhw:** satisfy compatibility lint ([5cc5764](https://github.com/totalolage/deskohub-site/commit/5cc5764299d0afe0abd4bad870acbefe0c185ab4))

## [1.8.0](https://github.com/totalolage/deskohub-site/compare/dhw-v1.7.0...dhw-v1.8.0) (2026-08-13)


### Features

* **dhw:** add per-customer discount use limits ([b254679](https://github.com/totalolage/deskohub-site/commit/b25467996d641395478758fe0050cbfbea8888cb))

## [1.7.0](https://github.com/totalolage/deskohub-site/compare/dhw-v1.6.0...dhw-v1.7.0) (2026-08-13)


### Features

* **dhw:** administer reservation access ([78231b4](https://github.com/totalolage/deskohub-site/commit/78231b4c34e47461e5408710003f0871785e3649))


### Bug Fixes

* **dhw:** replay reservation access mutations ([9e737be](https://github.com/totalolage/deskohub-site/commit/9e737bee6f21b53b2817534f7b796122fb13bcfa))

## [1.6.0](https://github.com/totalolage/deskohub-site/compare/dhw-v1.5.0...dhw-v1.6.0) (2026-08-11)


### Features

* **dhw:** enforce branded identifier contracts ([ff8a8f7](https://github.com/totalolage/deskohub-site/commit/ff8a8f762f1cf2787e851564c598204b36f626e0))


### Bug Fixes

* **dhw:** clarify CLI business documentation ([04eb193](https://github.com/totalolage/deskohub-site/commit/04eb19316d96e127a87a979644fa72b8b3069b0b))
* **dhw:** narrow mutation retry guarantee ([8c013ec](https://github.com/totalolage/deskohub-site/commit/8c013eca92b2ffcd4595d796f53eb5e3e14c7ea0))

## [1.5.0](https://github.com/totalolage/deskohub-site/compare/dhw-v1.4.0...dhw-v1.5.0) (2026-08-10)


### Features

* **dhw:** add administration mutations ([636df93](https://github.com/totalolage/deskohub-site/commit/636df93489d1a4811911ca3754745c8f73bcc823))
* **dhw:** add administration mutations ([926140a](https://github.com/totalolage/deskohub-site/commit/926140a2bbe470ba37a191057f3846902186cdf0))

## [1.4.0](https://github.com/totalolage/deskohub-site/compare/dhw-v1.3.0...dhw-v1.4.0) (2026-08-10)


### Features

* **dhw:** add administration read commands ([365a58c](https://github.com/totalolage/deskohub-site/commit/365a58c6e6838dc54ca98efa05b50de9ee1c7421))
* **dhw:** complete administration read commands ([77601b1](https://github.com/totalolage/deskohub-site/commit/77601b16d0007dd06e4188197cc5efbd1feaed7f))


### Bug Fixes

* **dhw:** preserve draft release boundaries ([3fb4d2e](https://github.com/totalolage/deskohub-site/commit/3fb4d2e0b3785087c874404f60c5db378f13e0c7))

## [1.3.0](https://github.com/totalolage/deskohub-site/compare/dhw-v1.2.0...dhw-v1.3.0) (2026-08-10)


### Features

* **dhw:** add browser-approved CLI authentication ([b12577e](https://github.com/totalolage/deskohub-site/commit/b12577e539c2bbc0d7dbaea399dba4faf83fd86d))
* **dhw:** add browser-approved CLI authentication ([b260f90](https://github.com/totalolage/deskohub-site/commit/b260f90420376fb76ce6a980da881308adbf64e6))
* **dhw:** add CLI foundation ([00ae714](https://github.com/totalolage/deskohub-site/commit/00ae7142d3d0f608abdbfdf1c300070521db9500))
* **dhw:** add CLI foundation ([647f40a](https://github.com/totalolage/deskohub-site/commit/647f40af653c09c7b5dd939cb523c88718507559))
* **dhw:** label CLI sessions by machine ([f89d021](https://github.com/totalolage/deskohub-site/commit/f89d021ea8acfcb7c2cd1a3a66ce976b457be09c))


### Bug Fixes

* **dhw:** close release and config gaps ([3835f5a](https://github.com/totalolage/deskohub-site/commit/3835f5a8f21bcc6f5037427c88a92ebd265cefe1))
* **dhw:** identify non-release builds ([d67ba3c](https://github.com/totalolage/deskohub-site/commit/d67ba3cb2b6867d6a26e3487969fdd6fbf0c947e))
* **dhw:** preserve single JSON auth output ([61c7a33](https://github.com/totalolage/deskohub-site/commit/61c7a331a38573df7b407d1cc52c7924c71688b0))
* **dhw:** rate limit CLI authentication starts ([f0a9652](https://github.com/totalolage/deskohub-site/commit/f0a965202ad37cd15fd92b1fff17dec14bf8b9d5))
* **dhw:** use tagged release results ([f8fe09d](https://github.com/totalolage/deskohub-site/commit/f8fe09d79f3a3047460468840af2e9e41b1184ce))

## [1.2.0](https://github.com/totalolage/deskohub-site/compare/dhw-v1.1.0...dhw-v1.2.0) (2026-08-10)


### Features

* **dhw:** add browser-approved CLI authentication ([b12577e](https://github.com/totalolage/deskohub-site/commit/b12577e539c2bbc0d7dbaea399dba4faf83fd86d))
* **dhw:** add browser-approved CLI authentication ([b260f90](https://github.com/totalolage/deskohub-site/commit/b260f90420376fb76ce6a980da881308adbf64e6))
* **dhw:** add CLI foundation ([00ae714](https://github.com/totalolage/deskohub-site/commit/00ae7142d3d0f608abdbfdf1c300070521db9500))
* **dhw:** add CLI foundation ([647f40a](https://github.com/totalolage/deskohub-site/commit/647f40af653c09c7b5dd939cb523c88718507559))
* **dhw:** label CLI sessions by machine ([f89d021](https://github.com/totalolage/deskohub-site/commit/f89d021ea8acfcb7c2cd1a3a66ce976b457be09c))


### Bug Fixes

* **dhw:** close release and config gaps ([3835f5a](https://github.com/totalolage/deskohub-site/commit/3835f5a8f21bcc6f5037427c88a92ebd265cefe1))
* **dhw:** identify non-release builds ([d67ba3c](https://github.com/totalolage/deskohub-site/commit/d67ba3cb2b6867d6a26e3487969fdd6fbf0c947e))
* **dhw:** preserve single JSON auth output ([61c7a33](https://github.com/totalolage/deskohub-site/commit/61c7a331a38573df7b407d1cc52c7924c71688b0))
* **dhw:** rate limit CLI authentication starts ([f0a9652](https://github.com/totalolage/deskohub-site/commit/f0a965202ad37cd15fd92b1fff17dec14bf8b9d5))
* **dhw:** use tagged release results ([f8fe09d](https://github.com/totalolage/deskohub-site/commit/f8fe09d79f3a3047460468840af2e9e41b1184ce))

## [1.1.0](https://github.com/totalolage/deskohub-site/compare/dhw-v1.0.0...dhw-v1.1.0) (2026-08-10)


### Features

* **dhw:** add browser-approved CLI authentication ([b12577e](https://github.com/totalolage/deskohub-site/commit/b12577e539c2bbc0d7dbaea399dba4faf83fd86d))
* **dhw:** add browser-approved CLI authentication ([b260f90](https://github.com/totalolage/deskohub-site/commit/b260f90420376fb76ce6a980da881308adbf64e6))
* **dhw:** label CLI sessions by machine ([f89d021](https://github.com/totalolage/deskohub-site/commit/f89d021ea8acfcb7c2cd1a3a66ce976b457be09c))


### Bug Fixes

* **dhw:** identify non-release builds ([d67ba3c](https://github.com/totalolage/deskohub-site/commit/d67ba3cb2b6867d6a26e3487969fdd6fbf0c947e))
* **dhw:** preserve single JSON auth output ([61c7a33](https://github.com/totalolage/deskohub-site/commit/61c7a331a38573df7b407d1cc52c7924c71688b0))
* **dhw:** rate limit CLI authentication starts ([f0a9652](https://github.com/totalolage/deskohub-site/commit/f0a965202ad37cd15fd92b1fff17dec14bf8b9d5))

## 1.0.0 (2026-08-06)


### Features

* **dhw:** add CLI foundation ([00ae714](https://github.com/totalolage/deskohub-site/commit/00ae7142d3d0f608abdbfdf1c300070521db9500))
* **dhw:** add CLI foundation ([647f40a](https://github.com/totalolage/deskohub-site/commit/647f40af653c09c7b5dd939cb523c88718507559))


### Bug Fixes

* **dhw:** close release and config gaps ([3835f5a](https://github.com/totalolage/deskohub-site/commit/3835f5a8f21bcc6f5037427c88a92ebd265cefe1))
* **dhw:** use tagged release results ([f8fe09d](https://github.com/totalolage/deskohub-site/commit/f8fe09d79f3a3047460468840af2e9e41b1184ce))
