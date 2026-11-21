"""Synthetic Finnish/English text-retrieval set. Every sentence here was written for this repo: no real library data.

Each topic has a Finnish and an English passage and a Finnish and an English query that is worded differently from
the passage, so ranking has to follow meaning, not shared words.
"""

from __future__ import annotations

TOPICS: list[dict[str, str]] = [
    {
        "fi": "Sähkölasku 03/2026. Kulutus 412 kWh, siirtomaksu ja energiamaksu eriteltynä. Eräpäivä on 14.4. ja viitenumero löytyy laskun yläkulmasta.",
        "en": "Electricity bill for March 2026. Usage 412 kWh with transmission and energy charges itemised. The due date is 14 April and the reference number is in the top corner.",
        "q_fi": "paljonko virtaa kului maaliskuussa",
        "q_en": "how much power did we use in March",
    },
    {
        "fi": "Vuokrasopimus kaksiolle Kalliossa. Vuokra 980 euroa kuukaudessa, vakuus kahden kuukauden vuokraa vastaava. Sopimus on toistaiseksi voimassa ja irtisanomisaika on kolme kuukautta.",
        "en": "Lease agreement for a two-room flat. Rent is 980 euros a month, deposit equal to two months. The contract runs until further notice with a three month notice period.",
        "q_fi": "asunnon vuokraehdot ja irtisanominen",
        "q_en": "apartment rental terms and how to terminate",
    },
    {
        "fi": "Kylpyhuoneremontin kuitti. Laatat, vedeneristys ja lattialämmitys yhteensä 3 420 euroa. Työn takuu on kaksi vuotta asennuspäivästä.",
        "en": "Receipt for the bathroom renovation. Tiles, waterproofing and underfloor heating came to 3,420 euros in total. The workmanship is guaranteed for two years from installation.",
        "q_fi": "paljonko kylpyhuoneen laittaminen maksoi",
        "q_en": "cost of redoing the bathroom",
    },
    {
        "fi": "Autovakuutuksen vakuutuskirja. Kasko ja liikennevakuutus, omavastuu 300 euroa. Bonus 70 prosenttia, vuosimaksu 612 euroa.",
        "en": "Car insurance policy letter. Comprehensive and liability cover, excess 300 euros. No-claims bonus 70 percent, yearly premium 612 euros.",
        "q_fi": "mitä auton vakuutus kattaa ja paljonko omavastuu on",
        "q_en": "what does the vehicle insurance cover and what is the deductible",
    },
    {
        "fi": "Lähete erikoislääkärille. Potilaalla on ollut kolme viikkoa jatkunutta polvikipua, röntgenkuva otettu eikä siinä näkynyt murtumaa. Pyydetään ortopedin arvio.",
        "en": "Referral to a specialist. The patient has had knee pain for three weeks, an x-ray was taken and showed no fracture. An orthopaedic assessment is requested.",
        "q_fi": "polvi kipeä, ohjaus jatkotutkimuksiin",
        "q_en": "sore knee sent on for further examination",
    },
    {
        "fi": "Veropäätös 2025. Ansiotulot 41 200 euroa, ennakkoverot 8 900 euroa, palautus 640 euroa maksetaan tilille kolmen viikon kuluessa.",
        "en": "Tax decision for 2025. Earned income 41,200 euros, prepaid tax 8,900 euros, a refund of 640 euros will be paid to your account within three weeks.",
        "q_fi": "saanko veronpalautusta ja milloin",
        "q_en": "will I get a tax refund and when",
    },
    {
        "fi": "Todistus peruskoulun yhdeksännen luokan lukuvuodelta. Matematiikka 9, suomi 8, englanti 10, liikunta 7. Käyttäytyminen erinomainen.",
        "en": "Report card for the ninth grade of comprehensive school. Mathematics 9, Finnish 8, English 10, physical education 7. Conduct excellent.",
        "q_fi": "koulun arvosanat yläasteen viimeiseltä vuodelta",
        "q_en": "grades from the final year of lower secondary school",
    },
    {
        "fi": "Karjalanpiirakoiden ohje. Keitä riisipuuro maidossa, rullaa ohut ruisjauhotaikina ja täytä puurolla. Paista 250 asteessa kymmenen minuuttia ja voitele voisulalla.",
        "en": "Recipe for Karelian pasties. Cook rice porridge in milk, roll out a thin rye dough and fill it with the porridge. Bake at 250 degrees for ten minutes and brush with melted butter.",
        "q_fi": "miten leivon riisitäytteisiä ruispiirakoita",
        "q_en": "how to bake rye pies filled with rice",
    },
    {
        "fi": "Astianpesukoneen käyttöohje. Valitse ohjelma, lisää tabletti ja sulje luukku. Jos kone ei tyhjennä vettä, puhdista pohjan suodatin ja tarkista poistoletku.",
        "en": "Dishwasher user manual. Choose a programme, add a tablet and close the door. If the machine does not drain, clean the filter at the bottom and check the drain hose.",
        "q_fi": "tiskikone ei pumppaa vettä pois",
        "q_en": "dishwasher is stuck full of water",
    },
    {
        "fi": "Lentovarausvahvistus Helsingistä Lissaboniin 12.5. Paluulento 19.5. Käsimatkatavara mukana, ruumaan menevä laukku maksaa erikseen 35 euroa.",
        "en": "Flight booking confirmation from Helsinki to Lisbon on 12 May with the return on 19 May. Cabin bag included, a checked suitcase costs 35 euros extra.",
        "q_fi": "matka Portugaliin toukokuussa",
        "q_en": "trip to Portugal in May",
    },
    {
        "fi": "Kokouspöytäkirja. Taloyhtiön yhtiökokous hyväksyi julkisivuremontin 280 000 euron budjetilla. Remontti alkaa keväällä ja asukkaille tiedotetaan erikseen.",
        "en": "Meeting minutes. The housing company's general meeting approved the facade renovation with a budget of 280,000 euros. Work starts in spring and residents will be informed separately.",
        "q_fi": "päätös talon ulkoseinien korjauksesta",
        "q_en": "decision about repairing the building exterior",
    },
    {
        "fi": "Puhelinliittymän sopimus. Rajaton data ja puhelut 24 euroa kuussa, 24 kuukauden määräaikainen sopimus. Lasku lähetetään sähköpostiin.",
        "en": "Mobile subscription agreement. Unlimited data and calls for 24 euros a month on a 24 month fixed term. The invoice is sent by email.",
        "q_fi": "matkapuhelinliittymän hinta ja sopimuskausi",
        "q_en": "phone plan price and contract length",
    },
    {
        "fi": "Työsopimus. Tehtävänä ohjelmistokehittäjä, kuukausipalkka 4 800 euroa, koeaika kuusi kuukautta. Työaika on 37,5 tuntia viikossa ja lomaa kertyy 2,5 päivää kuukaudessa.",
        "en": "Employment contract. Position software developer, monthly salary 4,800 euros, probation six months. Working time is 37.5 hours a week and holiday accrues 2.5 days a month.",
        "q_fi": "paljonko palkka on uudessa työpaikassa",
        "q_en": "salary and probation period in the new job",
    },
    {
        "fi": "Saunan lauteiden huolto. Hio lauteet hienolla hiekkapaperilla, pyyhi pöly ja levitä suoja-ainetta. Älä käytä lakkaa, koska se kuumenee ja tarttuu ihoon.",
        "en": "Sauna bench maintenance. Sand the benches with fine sandpaper, wipe off the dust and apply a protective treatment. Do not use varnish as it gets hot and sticks to the skin.",
        "q_fi": "miten hoidan löylyhuoneen penkkejä",
        "q_en": "how to look after wooden steam room seating",
    },
    {
        "fi": "Kuntosalin jäsenyys. Kuukausimaksu 39 euroa, sisältää ryhmäliikunnan ja kylpylän. Jäsenyyden voi jäädyttää enintään kolmeksi kuukaudeksi vuodessa.",
        "en": "Gym membership. Monthly fee 39 euros including group classes and the spa. The membership can be frozen for up to three months a year.",
        "q_fi": "voinko keskeyttää salikortin tilapäisesti",
        "q_en": "can I pause my fitness club subscription",
    },
    {
        "fi": "Kotivakuutuksen vahinkoilmoitus. Putkivuoto kylpyhuoneessa aiheutti kosteusvaurion lattiaan. Korjausarvio 4 100 euroa, liitteenä valokuvat ja urakoitsijan lausunto.",
        "en": "Home insurance claim. A pipe leak in the bathroom caused moisture damage to the floor. Repair estimate 4,100 euros, photographs and the contractor's statement attached.",
        "q_fi": "vesivahinko asunnossa korvaushakemus",
        "q_en": "claim for water damage at home",
    },
    {
        "fi": "Opintojakson kuvaus. Johdatus koneoppimiseen, 5 opintopistettä. Aiheina lineaarinen regressio, päätöspuut ja neuroverkkojen perusteet; tentti ja harjoitustyö.",
        "en": "Course description. Introduction to machine learning, 5 credits. Topics include linear regression, decision trees and neural network basics; exam and a project.",
        "q_fi": "yliopistokurssi tekoälyn alkeista",
        "q_en": "university class on the basics of artificial intelligence",
    },
    {
        "fi": "Kirjastokortin uusimisilmoitus. Kortti vanhenee 30.6. Uusi kortti haetaan lähimmästä kirjastosta henkilöllisyystodistusta näyttämällä. Erääntyneet lainat tulee palauttaa.",
        "en": "Library card renewal notice. The card expires on 30 June. A new card is collected from the nearest branch by showing proof of identity. Overdue loans must be returned.",
        "q_fi": "kirjaston jäsenkortti vanhenemassa",
        "q_en": "public library membership about to run out",
    },
    {
        "fi": "Pyörän huoltokuitti. Ketjut vaihdettu, jarrupalat uusittu ja vaihteet säädetty. Työ 85 euroa ja osat 62 euroa, seuraava huolto suositellaan syksyllä.",
        "en": "Bicycle service receipt. Chain replaced, brake pads renewed and gears adjusted. Labour 85 euros and parts 62 euros, the next service is recommended in autumn.",
        "q_fi": "polkupyörän korjaus ja varaosat",
        "q_en": "fixing the bike with new brakes",
    },
]

# Pairs that must NOT match: a query and a passage about different things (for the similarity floor).
NEGATIVE_QUERIES_FI = ["norsun painon laskeminen", "jalkapallon maailmanmestaruus", "kuun etäisyys maasta"]
NEGATIVE_QUERIES_EN = ["how heavy is an elephant", "football world championship results", "distance from the moon to earth"]
