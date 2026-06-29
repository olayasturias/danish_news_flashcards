// Common Danish stopwords — filtered out so flashcards focus on meaningful vocabulary.
// Based on the standard Danish stopword list (NLTK / snowball) plus frequent news fillers.
window.DANISH_STOPWORDS = new Set([
  "ad","af","aldrig","alle","alt","anden","andet","andre","at","bare","begge",
  "blev","blevet","bliver","blive","da","de","dem","den","denne","der","deres",
  "det","dette","dig","din","dine","disse","dit","dog","du","efter","ej","eller",
  "en","end","ene","eneste","enhver","er","et","far","fem","fik","fire","flere",
  "fleste","for","fordi","forrige","fra","få","får","før","god","godt","ham",
  "han","hans","har","havde","have","hej","helt","hende","hendes","her","hos",
  "hun","hvad","hvem","hver","hvilken","hvis","hvor","hvordan","hvorfor","hvornår",
  "i","ikke","ind","ingen","intet","ja","jeg","jer","jeres","jo","kan","kom",
  "komme","kommer","kun","kunne","lad","lige","lille","man","mand","mange","med",
  "meget","men","mens","mere","mig","min","mine","mit","mod","må","ned","nej",
  "ni","nogen","noget","nogle","nu","ny","nyt","når","næste","næsten","og","også",
  "okay","om","op","os","otte","over","på","se","seks","selv","ser","ses","sig",
  "sige","sin","sine","sit","skal","skulle","som","stor","store","syv","så","sådan",
  "tag","tage","thi","ti","til","to","tre","ud","under","var","ved","vi","vil",
  "ville","vor","vores","være","været",
  // frequent news/web fillers
  "ifølge","oplyser","siger","fortæller","sagde","både","samt","blandt","ifht",
  "procent","kroner","mio","mia","læs","foto","video","nyheder","artikel","kilde",
  "torsdag","fredag","lørdag","søndag","mandag","tirsdag","onsdag",
  "januar","februar","marts","april","maj","juni","juli","august","september",
  "oktober","november","december"
]);
