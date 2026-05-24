/**
 * barkConfig.js — Constants, Lookup Dictionaries, Firebase Config
 * Loaded SECOND in the boot sequence.
 */
window.BARK = window.BARK || {};

// ====== SEARCH NORMALIZATION DICTIONARY ======
window.BARK.normalizationDict = {
    'ft': 'fort',
    'mt': 'mount',
    'st': 'saint',
    'natl': 'national',
    'np': 'national park',
    'sp': 'state park',
    'nf': 'national forest',
    'nwr': 'national wildlife refuge',
    'mem': 'memorial',
    'rec': 'recreation',
    'hist': 'historic'
};

// ====== FIREBASE CONFIG ======
window.BARK.firebaseConfig = {
    apiKey: "AIzaSyDcBn2YQCAFrAjN27gIM9lBiu0PZsComO4",
    authDomain: "barkrangermap-auth.firebaseapp.com",
    projectId: "barkrangermap-auth",
    storageBucket: "barkrangermap-auth.firebasestorage.app",
    messagingSenderId: "564465144962",
    appId: "1:564465144962:web:9e43dbc993b93a33d5d09b",
    measurementId: "G-V2QCN2MFBZ"
};

// ====== SERVICE CONFIG ======
// ORS access is proxied through Firebase callables (getPremiumRoute,
// getPremiumGeocode). The key is held server-side as a Firebase secret;
// the client must never carry it. See services/orsService.js.
window.BARK.config = window.BARK.config || {};
window.BARK.config.CHECKIN_RADIUS_KM = 25;

// ====== VIRTUAL EXPEDITION TRAILS ======
window.BARK.TOP_10_TRAILS = [
    { id: 'half_dome', name: 'Half Dome', miles: 16.0, park: 'Yosemite National Park', info: 'Geologically, Half Dome is a granodiorite magma chamber that cooled slowly deep underground millions of years ago, later exposed and sheared in half by glacial activity. Before the 1870s, it was declared "perfectly inaccessible," but today, hikers ascend the final 400 feet using steel cables originally installed by the Sierra Club in 1919.' },
    { id: 'angels_landing', name: 'Angels Landing', miles: 5.0, park: 'Zion National Park', info: 'Formed around 200 million years ago from windblown sand dunes that turned into Navajo Sandstone, this narrow fin of rock was named in 1916 by explorer Frederick Fisher, who remarked that "only an angel could land on it." The trail itself is an engineering marvel, carved directly into the rock in 1926 to grant hikers access to its 1,500-foot vertical drop-offs.' },
    { id: 'zion_narrows', name: 'Zion Narrows', miles: 16.0, park: 'Zion National Park', info: 'This gorge represents millions of years of hydrology at work, where the Virgin River has sliced through Navajo Sandstone to create slot canyons up to 1,000 feet deep and sometimes just 20-30 feet wide. It is one of the world\'s premier examples of a slot canyon, requiring hikers to wade through the riverbed while being highly vigilant of sudden flash floods shaped by distant rainfall.' },
    { id: 'cascade_pass', name: 'Cascade Pass / Sahale Arm', miles: 12.1, park: 'North Cascades National Park', info: 'This route was historically used by Native Americans as a vital trading corridor across the rugged Cascade Range. Today, it offers a dramatic transition from subalpine meadows to the rocky moraines of the Sahale Glacier. It serves as a living classroom on glaciology and alpine ecosystems, frequently hosting wildlife like marmots, pikas, and mountain goats.' },
    { id: 'highline_trail', name: 'Highline Trail', miles: 11.8, park: 'Glacier National Park', info: 'Carved directly into the Garden Wall, an arête (a sharp mountain ridge formed by glaciation), this trail hugs the Continental Divide. It was blasted out of the rock in the 1920s to allow visitors to experience the park\'s dramatic, U-shaped valleys. The trail showcases the ancient, colorful sedimentary rock of the Belt Supergroup, dating back over a billion years.' },
    { id: 'harding_icefield', name: 'Harding Icefield', miles: 8.2, park: 'Kenai Fjords National Park', info: 'This rigorous trail acts as a time machine to the last Ice Age, concluding at the edge of the 700-square-mile Harding Icefield, a massive relic from the Pleistocene epoch. As hikers ascend, they walk backward through ecological succession, passing through cottonwood forests that recently colonized exposed land, up to barren, rocky terrain only recently surrendered by the shrinking Exit Glacier.' },
    { id: 'old_rag', name: 'Old Rag Trail', miles: 9.3, park: 'Shenandoah National Park', info: 'Old Rag Mountain is composed of billion-year-old Old Rag Granite, some of the oldest rock exposed in the eastern United States. The mountain\'s famous rock scramble is a result of millions of years of erosion removing softer surrounding rock, leaving behind the hard granite boulders. It is a world-class example of a batholith—magma that cooled deep beneath the Earth\'s crust.' },
    { id: 'emerald_lake', name: 'Emerald Lake', miles: 3.2, park: 'Rocky Mountain National Park', info: 'This trail offers a masterclass in glacial geology, taking hikers past a series of paternoster lakes (Nymph, Dream, and Emerald). These lakes were formed sequentially by retreating glaciers that gouged out depressions in the bedrock. The final destination, Emerald Lake, sits in a stunning "cirque"—a steep, bowl-shaped amphitheater sculpted by ice during the last glacial maximum.' },
    { id: 'precipice_trail', name: 'Precipice Trail', miles: 2.1, park: 'Acadia National Park', info: 'Scaled via a series of iron rungs and ladders embedded into Champlain Mountain, this trail navigates the exposed granite cliffs of a mountain shaped by heavy, mile-thick glaciers that retreated 15,000 years ago. It also serves as a crucial habitat for peregrine falcons, and the trail is often closed in early summer to protect the nesting sites of these incredible raptors, which can dive at speeds over 240 mph.' },
    { id: 'skyline_loop', name: 'Skyline Trail Loop', miles: 5.5, park: 'Mount Rainier National Park', info: 'This trail winds through the Paradise area, famous for having some of the most vibrant subalpine wildflower meadows on Earth, which bloom fiercely during the short summer window. Hikers also get unobstructed views of the Nisqually Glacier, providing a firsthand look at glaciology on one of the world\'s most dangerous stratovolcanoes, which is still geologically active.' },
    { id: 'grand_canyon_rim2rim', name: 'Grand Canyon Rim to Rim', miles: 44.0, park: 'Grand Canyon National Park', info: 'Crossing the Grand Canyon is a journey through deep time. As hikers descend to the Colorado River, hikers walk past nearly two billion years of Earth\'s geological history exposed in the canyon walls, from the 270-million-year-old Kaibab Limestone at the rim down to the ancient Vishnu Schist at the bottom. It spans several distinct ecosystems, equivalent to traveling from Canada to Mexico in a single day.' }
];
