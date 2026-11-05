# Cryptara Product Roadmap

Bu dosya projenin yeni urun yonunu tanimlar. Eski todo dosyalarindaki teknik maddeler korunabilir, ama urun karari icin ana referans bu dosya olmalidir.

## Product Vision

Cryptara, kullanicinin bir token kontratini veya DexScreener linkini girerek anlasilir bir AI risk raporu almasini saglayan Web3 risk intelligence urunudur.

Urunun temel vaadi:

- Kullanici tek bir tokeni hizlica analiz eder.
- Sistem contract, social, news ve portfolio baglaminda puan verir.
- Sonuc yuzdelerle, sebeplerle ve kaynaklarla aciklanir.
- Kullanici teknik JSON degil, sade bir risk raporu gorur.
- Detaya inmek isterse her agentin neden o puani verdigini gorebilir.
- Execution asamasi once kullanici onayli plan olarak gelir, sonra kuralli semi-auto modele evrilir.

Urun kesin sonuc iddia etmez. "Bu coin kesin iyi" veya "kesin kotu" demez. Bunun yerine:

- Alim riski su kadar.
- Ana riskler bunlar.
- Eksik veriler bunlar.
- Kaynak guveni su seviyede.
- Bu kosullarda onerilen aksiyon budur.

## Core Product Output

V1 ana ciktisi bir "AI Risk Report" olmalidir.

Ornek:

```text
AI Risk Report

Buy Risk: 74%
Confidence: 62%
Verdict: Watch

Bu token icin alim riski yuksek.
Ana risk contract tarafinda dusuk likidite ve holder yogunlasmasi.
Sosyal medya ilgisi yuksek, fakat engagement kalitesi zayif.
Haber tarafinda guclu pozitif katalist bulunamadi.
Wallet'inda bu token exposure'i yuksekse yeni alim onerilmez.
```

Altinda agent bazli skorlar gorunur:

```text
Contract Risk: 78/100
Social Trust: 54/100
News Signal: 32/100
Portfolio Exposure: 66/100
Final Buy Risk: 74/100
```

Her skorun altinda:

- Bu puan neden geldi?
- Hangi sinyaller skoru yukseltti?
- Hangi sinyaller riski azaltti?
- Hangi kaynaklar kullanildi?
- Hangi veri eksik?
- Confidence neden bu seviyede?

## V1 Goal

V1 hedefi: Kullanici bir token kontrati veya DexScreener linki girdiginde, sade UI icinde yuzdeli ve aciklanabilir token risk raporu alabilmeli.

V1 sonunda sistem kesinlikle sunlari yapabilmelidir:

- Contract veya DexScreener linki kabul eder.
- Token identity cozer.
- Contract/onchain risk puani uretir.
- Social risk/trust puani uretir.
- News signal/risk puani uretir.
- Wallet bagliysa portfolio exposure etkisini hesaplar.
- Final buy risk yuzdesi uretir.
- Final verdict uretir.
- Ana sebepleri kullanici diliyle yazar.
- Kaynaklari ve eksik verileri gosterir.
- Mock data kullaniliyorsa saklamaz; production live modda mock kullanmaz.
- Execution icin sadece approval-only trade plan hazirlar, otomatik alim satim yapmaz.

## V1 User Flow

1. Kullanici ana input alanina token contract address veya DexScreener linki girer.
2. Opsiyonel olarak wallet baglar.
3. "Analyze" butonuna basar.
4. Sistem token identity cozer.
5. Agentlar paralel calisir:
   - Contract Agent
   - Social Agent
   - News Agent
   - Portfolio Agent, wallet varsa
   - Decision Agent
6. Kullanici ustte tek bir AI Risk Report gorur.
7. Kullanici isterse agent kartlarini acarak detay gorur.
8. Eger aksiyon gerekiyorsa Execution panelinde trade plan gorur.
9. V1'de tum real blockchain aksiyonlari kullanici wallet onayi gerektirir.

## V1 UI Direction

UI sade, minimalist ve hafif oyun hissi tasimali. Teknik dashboard gibi bogucu olmamali.

Ana prensip:

- Tek input.
- Tek ana sonuc.
- Detaylar kartlarin icinde.
- Renkler ve meterlar kullaniciya hizli sinyal verir.
- Copy kisa ve net olur.

V1 ilk ekran:

- Token input
- Network selector
- Wallet connect
- Analyze button
- Son analiz varsa AI Risk Report

AI Risk Report karti:

- Buy Risk yuzdesi
- Confidence yuzdesi
- Verdict
- 3-5 ana sebep
- "Show agent details"

Agent kartlari:

- Contract Guard
- Social Scout
- News Oracle
- Portfolio Keeper
- Decision Core
- Execution Pilot

Kart gorunumu:

- Score
- Status
- Short finding
- Risk/trust meter
- Details drawer

Oyun hissi icin kullanilabilecek etiketler:

- Strengths
- Warnings
- Critical flags
- Missing evidence
- Agent verdict
- Power score yerine risk/trust score

UI'da kullanicinin ilk bakista anlamasi gerekenler:

- Almak riskli mi?
- Neden riskli?
- Hangi veri guvenilir?
- Hangi veri eksik?
- Benim wallet'im icin bu token uygun mu?
- Simdi bir aksiyon var mi?

## V1 Scoring Model

V1'de final skor tek basina magic number olmamali. Her agent kendi score breakdown'ini uretmeli.

### Final Buy Risk

Final Buy Risk 0-100 arasi olmalidir.

- 0-24: Low risk
- 25-49: Medium risk
- 50-74: High risk
- 75-100: Critical risk

Verdict mapping:

- 0-24: Buy small veya Hold, sadece confidence yeterliyse
- 25-49: Watch
- 50-74: Manual review veya Avoid, portfolio durumuna gore
- 75-100: Avoid

Not: Dusuk confidence varsa final verdict asla "safe" olmamali. Dusuk confidence durumunda "manual review" veya "watch" tercih edilir.

### Contract Risk Score

Contract Risk Score tokenin teknik ve piyasa yapisi riskini olcer.

Ana faktorler:

- Honeypot
- Cannot sell
- Blacklist
- Trading pause
- Owner can change balance
- Mint permission
- Proxy/upgradeability
- Hidden owner
- Buy tax
- Sell tax
- Liquidity USD
- FDV/liquidity ratio
- Volume/liquidity anomaly
- Pair age
- Holder concentration
- Top holder percent
- Top 5 / top 10 holders
- LP lock/burn
- Creator/deployer behavior

Ornek breakdown:

```text
Contract Risk: 78/100

+32 Low liquidity: $38k
+18 Sell tax: 14%
+14 Top 10 holders: 58%
+10 LP lock not verified
-8 No honeypot flag
-6 Sell simulation clean, if available
```

Critical override:

- Honeypot -> Avoid
- Cannot sell -> Avoid
- Active blacklist -> Avoid or manual review
- No liquidity + unknown identity -> Avoid/manual review
- Security provider missing + DEX missing -> Manual review

### Social Trust / Social Risk

Social Agent iki ayri seyi gostermeli:

- Social Trust Score
- Social Hype Risk

Social Trust Score yuksekse official identity ve topluluk daha guvenilir gorunur.
Social Hype Risk yuksekse manipulative/bot/shill riski vardir.

Faktorler:

- Official X/Twitter hesabinin dogrulanmasi
- Website ile social link uyumu
- DexScreener/CoinGecko/CMC link uyumu
- Contract address official kanallarda geciyor mu?
- Account age
- Verified status
- Follower count
- Engagement ratio
- Reply quality
- Duplicate replies
- Repeated phrases
- New account ratio
- Hype language
- Airdrop/claim/connect-wallet linkleri
- Phishing/drainer domainleri
- Impersonation risk

Ornek:

```text
Social Trust: 54/100
Hype Risk: 71/100

+24 Engagement ratio suspicious
+18 Repeated reply pattern
+16 Official account not mutually verified
-12 No phishing link found
-8 Website and X link match
```

Provider yoksa:

- Fake follower, fake engagement veya bot score uretilmez.
- Bot score unavailable olur.
- Confidence dusurulur.

### News Signal

News Agent haber ortamini olcer. Price prediction yapmaz.

Iki ana cikti:

- News Sentiment
- News Risk

Faktorler:

- Positive catalysts
- Exchange listing
- Partnership
- Funding
- Mainnet
- Integration
- Audit completed
- Hack/exploit
- Lawsuit/investigation
- Delisting
- Bankruptcy/halt
- Security warning
- Scam/rug/phishing mention
- Regulatory risk
- Source reliability
- Identity match confidence
- Recency
- Independent source count

Ornek:

```text
News Signal: 42/100
Positive News: 18%
Negative News Risk: 36%

+22 No strong positive catalyst found
+18 Only symbol-level matches found
-10 No hack/exploit article found
```

No news davranisi:

- Buyuk token icin no news normal olabilir.
- Yeni meme token icin no news + high social hype risk yaratabilir.
- News Agent tek basina no-news'i critical saymaz.

### Portfolio Exposure Score

Portfolio Agent wallet bagliysa token kararini kullaniciya ozel hale getirir.

Faktorler:

- Kullanici bu tokeni zaten tutuyor mu?
- Bu token wallet'in yuzde kaci?
- Tek token concentration
- Top 3 concentration
- Stable reserve
- Meme/high-risk exposure
- Low liquidity exposure
- Unknown price exposure
- Chain concentration
- Native gas readiness

Ornek:

```text
Portfolio Exposure: 66/100

Wallet'in %38'i bu tokenda.
Stable reserve %4.
Low-liquidity exposure %27.
Bu yuzden yeni alim yerine reduce/watch onerilir.
```

Wallet yoksa:

- Portfolio Agent "not connected" veya "unavailable" olur.
- Final karar token bazli verilir.
- Confidence portfolio coverage olmadigi icin dusurulur.

## V1 Decision Rules

Decision Agent deterministik olmali.

Kurallar:

- Contract critical ise social/news pozitif olsa bile avoid.
- Cannot sell varsa buy/swap hazirlanmaz.
- Phishing official link varsa manual review/avoid.
- Identity conflict varsa manual review.
- Source coverage yoksa manual review.
- Portfolio exposure yuksekse buy yerine watch/reduce.
- Social hype yuksek ama contract weak ise buy onerilmez.
- News positive olsa bile liquidity zayifsa watch/manual review.
- Confidence dusukse safe/buy denmez.

V1 final actions:

- Avoid
- Watch
- Buy small
- Hold
- Reduce exposure
- Manual review

V1'de "Buy small" sadece su kosullarda cikabilir:

- Contract risk critical degil.
- Sellability temiz veya kritik sorun yok.
- Liquidity minimum esigi geciyor.
- Identity confidence yeterli.
- Social phishing yok.
- Portfolio exposure limit altinda veya wallet yok.
- Confidence belirlenen minimum ustunde.

## V1 Execution Boundary

V1 execution otomatik alim satim yapmaz.

V1'de Execution Agent:

- Trade plan hazirlar.
- Quote varsa gosterir.
- Simulation varsa gosterir.
- Risk ve policy violations gosterir.
- Kullanici wallet onayi gerektigini gosterir.
- Server'in imza atamayacagini acikca gosterir.

V1'de Execution Agent yapmaz:

- Server private key tutmaz.
- Kullanici adina imza atmaz.
- Kendi kendine buy/sell yapmaz.
- Gercek quote yoksa executable transaction uretmez.
- Simulation yoksa high-risk trade confirm etmez.

V1 trade plan ornegi:

```text
Suggested Action: Watch
Execution: No trade prepared
Reason: Buy risk high and liquidity weak.
```

veya:

```text
Suggested Action: Reduce exposure
Execution: Trade plan available
Route: TOKEN -> USDC
Amount: 20%
Status: Requires live quote and wallet approval
```

## V1 Data / Supabase Plan

Supabase V1'e girmeden once schema netlesmeli. V1 icin gereken temel tablolar:

### token_scans

Her token analizini temsil eder.

Alanlar:

- id
- wallet_address nullable
- chain
- contract_address
- dex_screener_pair_url nullable
- symbol nullable
- token_name nullable
- final_buy_risk
- final_confidence
- final_verdict
- final_summary
- status
- created_at

### agent_scores

Her agentin bir scan icin urettigi sonucu tutar.

Alanlar:

- id
- scan_id
- agent
- score
- score_label
- confidence
- status
- summary
- recommended_action
- breakdown jsonb
- missing_data jsonb
- created_at

### score_factors

Agent skorunu etkileyen tekil faktorleri tutar.

Alanlar:

- id
- agent_score_id
- category
- label
- impact
- weight
- severity
- detail
- source_label nullable
- raw jsonb nullable

### source_snapshots

Kullanilan kaynaklari ve kanit snapshotlarini tutar.

Alanlar:

- id
- scan_id
- agent_score_id nullable
- provider
- label
- url nullable
- status
- checked_at
- latency_ms nullable
- reliability nullable
- error nullable
- raw_hash nullable
- sanitized_raw jsonb nullable

### wallet_portfolios

Wallet seviyesinde portfolio snapshot.

Alanlar:

- id
- wallet_address
- total_value_usd
- stable_reserve_percent
- largest_holding_percent
- risk_score
- confidence
- created_at

### portfolio_holdings

Portfolio snapshot icindeki tokenlar.

Alanlar:

- id
- portfolio_id
- chain
- token_address
- symbol
- name
- value_usd
- allocation_percent
- token_risk_score
- liquidity_risk
- price_reliability

### decisions

Final karar kaydi.

Alanlar:

- id
- scan_id
- wallet_address nullable
- action
- buy_risk
- confidence
- summary
- reasons jsonb
- blockers jsonb
- what_would_change jsonb
- decision_hash nullable
- created_at

### execution_plans

Trade plan veya no-action plan.

Alanlar:

- id
- decision_id
- wallet_address
- action
- from_token nullable
- to_token nullable
- percent nullable
- estimated_value_usd nullable
- quote jsonb nullable
- simulation jsonb nullable
- policy_status jsonb
- status
- expires_at nullable
- created_at

### transactions

Kullanici onayli transaction kaydi.

Alanlar:

- id
- execution_plan_id nullable
- wallet_address
- chain
- tx_hash
- status
- action
- value_usd nullable
- confirmed_at nullable
- created_at

### user_rules

Kullanici risk ve execution kurallari.

Alanlar:

- id
- wallet_address
- max_buy_risk
- max_trade_percent
- max_daily_value_usd
- min_liquidity_usd
- max_single_token_exposure_percent
- min_stable_reserve_percent
- allowed_chains jsonb
- blocked_tokens jsonb
- auto_mode_enabled boolean default false
- created_at
- updated_at

## V1 Contract Plan

V1'de kontrat zorunlu olmamali. V1'in ana hedefi risk report ve approval-only execution'dir.

Mevcut CryptaraVault V1 icin sadece audit/log prototipi olarak kalabilir.

V1 kontrat ihtiyaci:

- Compile gecmeli.
- Deploy script calismali.
- Frontend ana flow kontrata bagimli olmamali.
- Kontrat production execution icin kullaniliyormus gibi sunulmamali.

V1 sonunda kontrat icin net karar:

- Mevcut kontrat sadece audit log olarak mi kalacak?
- Yoksa V2 icin yeni policy/agent authorization kontratina mi evrilecek?

## V1 Definition of Done

V1 kesinlikle bitmis sayilmasi icin asagidaki maddelerin hepsi tamamlanmali.

### Product DoD

- Kullanici contract address veya DexScreener linki ile analiz baslatabiliyor.
- AI Risk Report tek ekranda anlasilir sekilde gorunuyor.
- Buy Risk %, Confidence %, Verdict ve summary gorunuyor.
- En az 3 ana sebep gorunuyor.
- Agent detaylari acilir/kapanir sekilde gorunuyor.
- Eksik veri ve unavailable provider kullaniciya saklanmiyor.
- Mobile ve desktop UI kirilmiyor.

### Agent DoD

- Contract Agent skor ve breakdown uretiyor.
- Social Agent skor ve breakdown uretiyor.
- News Agent skor ve breakdown uretiyor.
- Portfolio Agent wallet varsa exposure etkisi uretiyor.
- Decision Agent final verdict uretiyor.
- Tum agentlar `score`, `confidence`, `summary`, `findings`, `sources`, `missingData` donuyor.
- Critical blocker final kararda kaybolmuyor.
- Dusuk confidence safe olarak yorumlanmiyor.

### Execution DoD

- Execution Agent auto-execute yapmiyor.
- Server cannot sign bilgisi UI'da gorunuyor.
- Quote yoksa executable trade uretilmiyor.
- High-risk trade simulation olmadan confirm edilmiyor.
- Confirm endpoint duplicate tx hash ve wallet mismatch engelliyor.

### Storage DoD

- Supabase migration uygulanmis oluyor.
- Memory adapter production icin yeterli sayilmiyor.
- Token scans, agent scores, source snapshots, decisions ve execution plans kalici tutuluyor.
- History sayfasi Supabase verisini okuyabiliyor.

### Test DoD

- Unit/fixture agent tests geciyor.
- Lint geciyor.
- Build geciyor.
- Smoke test geciyor.
- Contract compile geciyor.
- Supabase migration temiz local DB'ye uygulanabiliyor.

### Release DoD

- Production env tamam.
- Provider API keys set.
- Supabase env set.
- No mock fallback in production.
- Rollback plan hazir.
- Known limitations gorunur.
- First 24 hours provider failure ve manual review oranlari izlenir.
- Smoke test production URL uzerinde gecer.

## V2 Goal

V2 hedefi: Kullanici kurallarina bagli semi-auto execution ve kalici intelligence history.

V2'de kullanici sadece rapor almakla kalmaz, sistem onun stratejisine gore izleme ve islem hazirligi yapar.

## V2 Features

### Persistent User Intelligence

- Kullanici scan history gorur.
- Tokenin skor degisimini zaman icinde gorur.
- Agent decision history gorur.
- Portfolio risk trend gorur.
- Watchlist olusturur.

### User Strategy

Kullanici su kurallari belirler:

- Conservative / Balanced / Aggressive / Custom
- Max buy risk
- Max trade amount
- Max daily value
- Max single-token exposure
- Min stable reserve
- Allowed chains
- Blocked tokens
- Blocked categories
- Meme token max exposure
- Minimum liquidity threshold

### Semi-Auto Execution Preparation

V2'de agent hala kendi basina imza atmaz. Ama kullanici kurallari uygunsa otomatik trade plan hazirlayabilir.

Ornek:

- Token buy risk 82 oldu.
- Kullanici bu tokeni tutuyor.
- Rule: risk > 75 ise reduce plan hazirla.
- Execution Agent quote alir.
- Simulation ister.
- Kullaniciya "Approve in wallet" flow acar.

### Real Quote Provider

V2'de quote provider gercek olmalidir.

Opsiyonlar:

- 0x
- 1inch
- ParaSwap
- Jupiter, Solana icin
- Chain-specific DEX aggregator

Quote ciktisi:

- route
- expected output
- price impact
- slippage
- gas
- calldata, sadece kullanici onayi icin
- expiry

### Real Simulation

V2'de high-risk execution icin simulation gereklidir.

Opsiyonlar:

- Tenderly
- Alchemy simulation
- Blocknative
- Chain-specific simulation

Simulation ciktisi:

- success/fail
- revert reason
- balance delta
- allowance risk
- expected output
- gas

### Supabase Production Adapter

V2'de memory adapter kalmamali.

Gerekenler:

- Supabase client
- server-only service role
- RLS karari
- migrations
- typed DB helpers
- write error handling
- health check
- audit trail

### Contract V2

V2 kontrat hedefi:

- User policy hash loglama
- Agent authorization
- Decision hash loglama
- Execution intent loglama
- Revoke agent
- Emergency pause

V2'de kontrat hala fon tutmak zorunda degil. Ama onchain audit ve agent authorization baslamalidir.

## V2 Definition of Done

- Supabase production adapter aktif.
- Scan/decision/history kalici.
- Watchlist var.
- User strategy/rules kalici.
- Real quote provider entegre.
- Real simulation provider entegre.
- Execution plan kullanici wallet onayina hazir calldata uretiyor.
- High-risk action simulation olmadan ilerlemiyor.
- Contract V2 audit/authorization icin deploy edilebilir.
- UI kullaniciya trade riskini ve approval riskini acik gosteriyor.

## V3 Goal

V3 hedefi: Guvenli, limitli, kullanici kontrollu otomatik execution ve discovery agent.

V3 tam otomatik "bot kafasina gore trade yapsin" olmamali. V3, kullanicinin onceden verdigi kurallar ve onchain limitler icinde calisan semi-auto/auto execution sistemidir.

## V3 Features

### Vault / Policy Contract

V3'te kontrat urunun merkezine girer.

Kontrat sorumluluklari:

- User funds veya allowance modeli netlesir.
- User policy onchain tutulur veya hashlenir.
- Agent authorization tutulur.
- Daily limit tutulur.
- Max trade percent tutulur.
- Allowed chains/tokens tutulur.
- Blocked tokens tutulur.
- Emergency pause olur.
- User revoke her zaman mumkun olur.
- Execution intent kaydedilir.
- Decision hash kaydedilir.
- Nonce/idempotency olur.
- Expiry olur.

Guvenlik:

- Server private key tutmaz.
- Agent yetkisi sinirli olur.
- Kullanici fonlari sonsuz yetkiye acilmaz.
- Infinite approval uyarisi vardir.
- Allowance azaltma/revoke onerisi vardir.
- Contract pause/revoke acik olur.

### EIP-712 Approval Model

V3'te kullanici kurallari ve execution intent imzalanabilir.

Ornek:

- User signs policy
- Agent proposes decision
- Server stores source snapshots
- Contract verifies policy/agent/expiry/nonce
- Execution sadece limitler icinde olur

### Auto Mode

Auto mode varsayilan kapali olmalidir.

Auto mode acmak icin kullanici sunlari kabul eder:

- Max daily spend
- Max token risk
- Allowed token list
- Allowed chain list
- Max slippage
- Max price impact
- Stop loss / take profit rules
- Emergency pause
- Revoke flow

Auto mode asla sunlari yapmamali:

- Unknown token buy
- Critical contract risk buy
- Cannot-sell token buy
- Phishing/social identity conflict buy
- No source coverage buy
- User limits disinda trade

### Discovery Agent

V3 veya V2.5'te eklenebilir.

Discovery Agent surekli tarama yapar:

- DexScreener new pairs
- Solana memecoin radar
- Base memecoin radar
- GOAT ecosystem radar
- Pair age
- Liquidity growth
- Volume anomaly
- Holder growth
- Social burst
- News catalyst

Discovery Agent ciktisi:

- Watchlist candidate
- Risky candidate
- Scam candidate
- Early opportunity candidate

Discovery Agent trade yapmaz. Sadece aday bulur. Decision ve Execution kurallari ayrica calisir.

### Alert System

V3'te kullanici alarm alabilir:

- Token risk critical oldu.
- Liquidity dustu.
- Holder concentration artti.
- Sell tax degisti.
- Social phishing link gorundu.
- News exploit cikti.
- Portfolio concentration asildi.
- Stable reserve dustu.

## V3 Definition of Done

- Vault/policy contract audit-ready.
- Auto mode default off.
- User revoke ve emergency pause calisiyor.
- EIP-712 policy/intent modeli var.
- Onchain/offchain decision hash baglantisi var.
- Real quote + simulation + transaction lifecycle tamam.
- Discovery Agent aday buluyor.
- Alert sistemi calisiyor.
- Production monitoring ve incident response aktif.

## Current Reality Check

Mevcut kodun durumu:

- Agent mimarisi var.
- Contract/onchain, social, news, portfolio, decision ve execution modulleri var.
- Fixture tests geciyor.
- Build geciyor.
- Contract compile geciyor.
- UI temel sayfalari var.
- Provider yoksa mock saklamama davranisi iyi.

Eksikler:

- Supabase production adapter yok, storage memory.
- Execution quote/simulation gercek degil, planned/unavailable.
- Kontrat frontend'e bagli degil.
- Mevcut kontrat V2/V3 execution modeline yetmez.
- UI henuz istenen sade oyun tarzi risk report formatina tam donusmedi.
- LLM/OpenAI aktif kullanilmiyor; agentlar deterministik risk motoru.
- Eski backend mock dosyalari repo icinde duruyor ve kafa karistiriyor.

## Immediate Next Steps

Supabase'e gecmeden once siradaki isler:

1. V1 UI bilgi mimarisini netlestir.
2. AI Risk Report response modelini standardize et.
3. Agent score breakdown formatini tek tipe bagla.
4. Scan page'i V1 risk report ekranina cevir.
5. Portfolio Agent'in yuzdeli breakdown'ini UI'da gorunur yap.
6. Supabase schema'yi bu dosyadaki V1 tablolara gore netlestir.
7. Migration'i Supabase'e uygula.
8. Storage adapter'i memory'den Supabase'e gecir.
9. V1 release gate'i tekrar calistir.

## Product Rule

V1 bitmeden V2 execution otomasyonu veya V3 discovery scanner eklenmemelidir.

Once ana sistem oturmali:

- Token gir.
- Risk raporu al.
- Agent skorlarini gor.
- Kaynaklari gor.
- Portfolio etkisini gor.
- Guvenli execution preview gor.

Bu cekirdek mukemmel hale gelmeden surekli tarama, auto trading veya vault otomasyonu eklemek urunu karmasiklastirir.
