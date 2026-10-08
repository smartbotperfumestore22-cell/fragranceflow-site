// Demo catalog in the Master Database schema (same fields the widget gets from Apps Script, already parsed).
// Prices are approximate Moroccan retail prices in MAD for the full bottle. Images are illustrative until partner photos arrive.
// [name, brand, gender, character, occasion, season, price, size, concentration, top, middle, base, imageKey, world]
// world: designer | niche | ultra_niche | arabian ("" = not classified yet; such a fragrance only shows under "no preference")
const RAW = [
  ["Sauvage","Dior","men","fresh,citrus,woody","daily,dates,evening","summer,spring,autumn",1350,"100ml","EDT","Bergamot,Pepper","Lavender,Sichuan Pepper,Geranium","Ambroxan,Cedar,Labdanum","c2","designer"],
  ["Bleu de Chanel","Chanel","men","woody,fresh,citrus","daily,evening,dates","allseasons",1650,"100ml","EDP","Grapefruit,Lemon,Mint","Ginger,Jasmine,Nutmeg","Incense,Cedar,Sandalwood","c2","designer"],
  ["Acqua di Giò","Giorgio Armani","men","aquatic,fresh,citrus","daily,travel,dates","summer,spring",1150,"100ml","EDT","Lime,Lemon,Bergamot","Sea Notes,Rosemary,Jasmine","Patchouli,White Musk,Cedar","c2","designer"],
  ["Invictus","Paco Rabanne","men","aquatic,fresh,woody","daily,evening","summer,spring",1050,"100ml","EDT","Grapefruit,Sea Notes,Mandarin","Bay Leaf,Jasmine","Guaiac Wood,Oakmoss,Ambergris","c2","designer"],
  ["1 Million","Paco Rabanne","men","oriental,sweet,heavy","evening,dates","winter,autumn",1100,"100ml","EDT","Grapefruit,Mint,Blood Mandarin","Cinnamon,Rose,Spices","Leather,Amber,Patchouli","c3","designer"],
  ["Eros","Versace","men","sweet,fresh","evening,dates","summer,spring,autumn",1000,"100ml","EDT","Mint,Green Apple,Lemon","Tonka Bean,Geranium","Vanilla,Cedar,Vetiver","c3","designer"],
  ["Le Male","Jean Paul Gaultier","men","sweet,oriental","evening,dates","winter,autumn",1050,"125ml","EDT","Mint,Lavender,Cardamom","Cinnamon,Orange Blossom,Cumin","Vanilla,Tonka Bean,Sandalwood","c3","designer"],
  ["Terre d'Hermès","Hermès","men","woody,citrus","daily,evening","allseasons",1400,"100ml","EDT","Orange,Grapefruit","Pepper,Flint,Geranium","Vetiver,Cedar,Patchouli","c5","designer"],
  ["Aventus","Creed","men","fruity,woody,fresh","daily,evening,dates","summer,spring,autumn",3900,"100ml","EDP","Pineapple,Bergamot,Black Currant","Birch,Patchouli,Jasmine","Musk,Oakmoss,Ambergris","c5","niche"],
  ["Oud Wood","Tom Ford","unisex","oriental,woody,heavy","evening","winter,autumn",3200,"50ml","EDP","Rosewood,Cardamom","Oud,Sandalwood,Vetiver","Tonka Bean,Amber,Vanilla","c3","niche"],
  ["Armani Code","Giorgio Armani","men","oriental,sweet","evening,dates","winter,autumn",1150,"75ml","EDT","Lemon,Bergamot","Star Anise,Olive Blossom","Leather,Tonka Bean,Tobacco","c5","designer"],
  ["Boss Bottled","Hugo Boss","men","woody,sweet","daily,evening","winter,autumn,spring",850,"100ml","EDT","Apple,Plum,Lemon","Cinnamon,Geranium,Clove","Sandalwood,Vetiver,Cedar","c5","designer"],
  ["Allure Homme Sport","Chanel","men","fresh,citrus,aquatic","daily,travel","summer,spring",1400,"100ml","EDT","Orange,Sea Notes,Aldehydes","Pepper,Neroli,Cedar","Tonka Bean,White Musk,Vetiver","c2","designer"],
  ["Spicebomb","Viktor&Rolf","men","oriental,heavy,sweet","evening,dates","winter",1200,"90ml","EDT","Bergamot,Pink Pepper,Grapefruit","Cinnamon,Saffron,Chili","Tobacco,Leather,Vetiver","c5","designer"],
  ["Light Blue Pour Homme","Dolce & Gabbana","men","fresh,citrus,aquatic","daily,travel","summer",850,"125ml","EDT","Grapefruit,Bergamot,Juniper","Rosemary,Pepper,Rosewood","Musk,Incense,Oakmoss","c2","designer"],
  ["Dior Homme Intense","Dior","men","woody,floral,heavy","evening,dates","winter,autumn",1500,"100ml","EDP","Lavender","Iris,Ambrette,Pear","Cedar,Vetiver","c5","designer"],
  ["Club de Nuit Intense Man","Armaf","men","fruity,woody,fresh","evening,daily","summer,spring,autumn",450,"105ml","EDT","Lemon,Pineapple,Black Currant","Birch,Jasmine,Rose","Musk,Ambergris,Patchouli","c5","arabian"],
  ["Coco Mademoiselle","Chanel","women","floral,oriental","daily,evening,dates","allseasons",1750,"100ml","EDP","Orange,Bergamot","Rose,Jasmine,Litchi","Patchouli,Vanilla,White Musk","c1","designer"],
  ["N°5","Chanel","women","floral,clean","evening","winter,autumn",1850,"100ml","EDP","Aldehydes,Ylang-Ylang,Neroli","Rose,Jasmine,Iris","Sandalwood,Vanilla,Vetiver","c1","designer"],
  ["La Vie est Belle","Lancôme","women","sweet,floral","daily,evening,dates","winter,autumn,spring",1300,"100ml","EDP","Black Currant,Pear","Iris,Jasmine,Orange Blossom","Praline,Vanilla,Patchouli","c4","designer"],
  ["Black Opium","Yves Saint Laurent","women","sweet,oriental","evening,dates","winter,autumn",1300,"90ml","EDP","Pear,Pink Pepper,Orange Blossom","Coffee,Jasmine","Vanilla,Patchouli,Cedar","c3","designer"],
  ["Libre","Yves Saint Laurent","women","floral,fresh","daily,evening","allseasons",1350,"90ml","EDP","Lavender,Mandarin,Black Currant","Jasmine,Orange Blossom","Vanilla,Musk,Cedar","c4","designer"],
  ["J'adore","Dior","women","floral,fruity","daily,evening","summer,spring",1500,"100ml","EDP","Pear,Melon,Peach","Jasmine,Rose,Lily","Musk,Vanilla,Cedar","c1","designer"],
  ["Miss Dior Blooming Bouquet","Dior","women","floral,fresh,clean","daily,dates","summer,spring",1250,"100ml","EDT","Mandarin,Bergamot","Peony,Rose,Apricot","White Musk","c1","designer"],
  ["Gucci Bloom","Gucci","women","floral,clean","daily,dates","summer,spring",1200,"100ml","EDP","Jasmine","Tuberose","Rangoon Creeper,Orris","c1","designer"],
  ["Flowerbomb","Viktor&Rolf","women","floral,sweet","evening,dates","winter,autumn",1350,"100ml","EDP","Tea,Bergamot,Osmanthus","Jasmine,Orchid,Rose","Patchouli,Musk,Vanilla","c4","designer"],
  ["Good Girl","Carolina Herrera","women","sweet,oriental","evening,dates","winter,autumn",1350,"80ml","EDP","Almond,Coffee,Bergamot","Tuberose,Jasmine,Orange Blossom","Tonka Bean,Cacao,Vanilla","c3","designer"],
  ["Daisy","Marc Jacobs","women","fruity,floral,fresh","daily,travel","summer,spring",900,"100ml","EDT","Strawberry,Violet Leaf,Grapefruit","Violet,Jasmine,Gardenia","Musk,Vanilla,White Woods","c1","designer"],
  ["Light Blue","Dolce & Gabbana","women","fresh,citrus,fruity","daily,travel","summer",850,"100ml","EDT","Lemon,Apple,Cedar","Bamboo,Jasmine,White Rose","Cedar,Musk,Amber","c1","designer"],
  ["Si","Giorgio Armani","women","floral,sweet","daily,evening","winter,autumn,spring",1250,"100ml","EDP","Black Currant","Rose,Freesia","Vanilla,Patchouli,Woody Notes","c4","designer"],
  ["Lady Million","Paco Rabanne","women","sweet,floral,fruity","evening,dates","winter,autumn",1100,"80ml","EDP","Raspberry,Neroli,Lemon","Orange Blossom,Jasmine,Gardenia","Honey,Patchouli,Amber","c3","designer"],
  ["Alien","Mugler","women","woody,floral,heavy","evening","allseasons",1250,"60ml","EDP","Jasmine","Cashmeran,Woody Notes","White Amber","c4","designer"],
  ["Angel","Mugler","women","sweet,oriental,heavy","evening","winter",1200,"100ml","EDP","Cotton Candy,Melon,Bergamot","Red Berries,Honey,Jasmine","Chocolate,Caramel,Patchouli","c3","designer"],
  ["Burberry Her","Burberry","women","fruity,sweet","daily,dates","summer,spring,autumn",1100,"100ml","EDP","Strawberry,Raspberry,Blackberry","Violet,Jasmine","Musk,Vanilla,Amber","c1","designer"],
  ["Acqua di Gioia","Giorgio Armani","women","aquatic,fresh,citrus","daily,travel","summer",1050,"100ml","EDP","Mint,Lemon,Pink Pepper","Jasmine,Peony,Sea Notes","Cedar,Labdanum,Brown Sugar","c4","designer"],
  ["Yara","Lattafa","women","sweet,fruity,musky","daily,dates","summer,spring,autumn",250,"100ml","EDP","Orchid,Heliotrope,Tangerine","Tropical Fruits,Gourmand","Vanilla,Musk,Sandalwood","c1","arabian"],
  ["English Pear & Freesia","Jo Malone","unisex","fruity,floral,fresh","daily,dates","summer,spring",1500,"100ml","EDC","Pear,Melon","Freesia,Rose","Patchouli,Amber,Rhubarb","c1","niche"],
  ["Baccarat Rouge 540","Maison Francis Kurkdjian","unisex","oriental,sweet,woody","evening,dates","winter,autumn,spring",3800,"70ml","EDP","Saffron,Jasmine","Amberwood,Ambergris","Fir Resin,Cedar","c3","niche"],
  ["Khamrah","Lattafa","unisex","sweet,oriental,heavy","evening,dates","winter",350,"100ml","EDP","Cinnamon,Nutmeg,Bergamot","Dates,Praline,Tuberose","Vanilla,Tonka Bean,Amberwood","c3","arabian"],
  ["By the Fireplace","Maison Margiela","unisex","woody,sweet","evening,dates","winter",1550,"100ml","EDT","Pink Pepper,Orange Blossom,Clove","Chestnut,Guaiac Wood,Juniper","Vanilla,Peru Balsam,Cashmeran","c5","niche"],
  ["Jazz Club","Maison Margiela","unisex","sweet,woody,heavy","evening,dates","winter,autumn",1550,"100ml","EDT","Pink Pepper,Lemon,Neroli","Rum,Clary Sage,Java Vetiver","Tobacco,Vanilla,Styrax","c5","niche"]
];
const split = s => s.split(",").map(x => x.trim()).filter(Boolean);
export function buildCatalog(IMG) {
  return RAW.map((r, i) => ({
    id: "ff-" + (i + 1), name: r[0], brand: r[1], gender: [r[2]], character: split(r[3]),
    occasion: split(r[4]), season: split(r[5]), price: r[6], size: r[7], sizeType: "full",
    concentration: r[8], notes: { top: split(r[9]), middle: split(r[10]), base: split(r[11]) },
    image: IMG[r[12]], world: r[13] || "", url: "", store: "", active: true, boost: 0
  }));
}
