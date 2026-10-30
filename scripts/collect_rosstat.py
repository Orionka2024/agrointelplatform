"""Collect public Rosstat onion data. Requires Python 3 + openpyxl (read-only).
Never fabricates publication dates, fills suppressed cells, or converts monthly data to weekly.
TLS trust is scoped to this Rosstat request context, never installed system-wide.
"""
import argparse, datetime as dt, hashlib, json, re, ssl, urllib.request
from zipfile import ZipFile
import xml.etree.ElementTree as ET
from pathlib import Path
import openpyxl
from openpyxl.utils import get_column_letter

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'data/sources/rosstat'
PAGE = 'https://rosstat.gov.ru/statistics/price'
MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря']

def sha(b): return hashlib.sha256(b).hexdigest()
def number(v): return isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0

def fetch(url):
    if not url.startswith('https://rosstat.gov.ru/'):
        raise ValueError('Only the official Rosstat HTTPS host is allowed')
    context = ssl.create_default_context(cafile=str(RAW / 'download-ca.pem'))
    with urllib.request.urlopen(url, context=context, timeout=60) as r:
        content = r.read(30_000_001)
    if len(content) > 30_000_000: raise ValueError('Source exceeds 30 MB')
    return content

def source_file(index, pattern, today, download):
    hrefs = re.findall(r'href="([^\"]+)"', index)
    found = [x for x in hrefs if re.fullmatch(pattern, x)]
    if len(set(found)) != 1: raise ValueError('Source layout changed: expected one link '+pattern)
    href=found[0]; name=href.rsplit('/',1)[1]
    section=index[index.index(href):].split('<a ',1)[0]
    dates=re.findall(r'(\d{2}\.\d{2}\.\d{4})',section)
    if not dates: raise ValueError('Missing source publication date')
    published=dt.datetime.strptime(dates[-1],'%d.%m.%Y').date().isoformat()
    if published>today: raise ValueError('Publication is in the future')
    p=RAW/name
    content=fetch('https://rosstat.gov.ru'+href) if download else p.read_bytes()
    digest=sha(content)
    archive=RAW/(digest[:16]+'-'+name)
    if not archive.exists(): archive.write_bytes(content)
    return archive, {'id':digest[:16], 'url':'https://rosstat.gov.ru'+href,'indexUrl':PAGE,
        'sha256':digest,'file':str(archive.relative_to(ROOT)),'publishedDate':published,
        'retrievedDate':today,'vintage':'latest_revision_snapshot','originalReleaseDatesKnown':False}

def cell_record(s,row,col,value,source,**extra):
    return {**extra,'value':value,'sourceId':source['id'],'sheet':s.title,
            'cell':f'{get_column_letter(col)}{row}','rawValue':s.cell(row,col).value,
            'availableDate':source['publishedDate']}

def extract(index,today,download=False):
    path,prod=source_file(index,r'/storage/mediabank/cena_sx_\d{2}-\d{4}\.xlsx',today,download)
    w=openpyxl.load_workbook(path,read_only=False,data_only=True)
    monthly=[]; annual=[]; regional=[]
    for s in w:
        title=' '.join(str(s.cell(r,1).value or '') for r in range(1,4))
        year_match=re.search(r'в (20\d{2}) г',title)
        if not year_match or 'на конец периода' not in title: continue
        year=int(year_match[1])
        matches=[r for r in range(1,s.max_row+1) if str(s.cell(r,1).value).strip().lower()=='лук репчатый']
        if len(matches)!=1: raise ValueError('Onion row missing/ambiguous in '+s.title)
        r=matches[0]
        if s.cell(r,2).value!='01.13.43.110': raise ValueError('Unexpected onion classification')
        if s.cell(r+1,1).value=='Российская Федерация':
            r+=1
            for rr in range(r+1,s.max_row+1):
                if s.cell(rr,2).value: break
                region=s.cell(rr,1).value
                if not region: break
                for c in range(3,min(s.max_column,14)+1):
                    v=s.cell(rr,c).value
                    if number(v): regional.append(cell_record(s,rr,c,round(v/1000,5),prod,period=f'{year}-{c-2:02}',region=region,unit='RUB/kg'))
        for c in range(3,min(s.max_column,14)+1):
            v=s.cell(r,c).value; period=f'{year}-{c-2:02}'
            if number(v) and period<=today[:7]:
                monthly.append(cell_record(s,r,c,round(v/1000,5),prod,period=period,unit='RUB/kg'))
    s=w['1.1']
    r=next(r for r in range(1,s.max_row+1) if str(s.cell(r,1).value).strip().lower()=='лук репчатый')
    for c in range(2,s.max_column+1):
        match=re.match(r'(20\d{2})',str(s.cell(4,c).value)); v=s.cell(r,c).value
        if match and number(v): annual.append(cell_record(s,r,c,round(v/1000,5),prod,year=int(match[1]),unit='RUB/kg',measure='annual_average'))
    monthly.sort(key=lambda r:r['period'])
    if len({r['period'] for r in monthly})!=len(monthly): raise ValueError('Duplicate producer month')
    expected=[f'{y}-{m:02}' for y in range(int(monthly[0]['period'][:4]),int(monthly[-1]['period'][:4])+1) for m in range(1,13) if monthly[0]['period']<=f'{y}-{m:02}'<=monthly[-1]['period']]
    if expected!=[r['period'] for r in monthly]: raise ValueError('Producer monthly history has gaps')
    path,retail=source_file(index,r'/storage/mediabank/nedel_sred_cen\.xlsx',today,download)
    w=openpyxl.load_workbook(path,data_only=True)
    weekly=[]
    for s in w:
        if not re.fullmatch(r'20\d\d',s.title): continue
        r=next(r for r in range(1,s.max_row+1) if str(s.cell(r,1).value).strip()=='Лук репчатый, кг')
        for c in range(2,s.max_column+1):
            heading=str(s.cell(4,c).value or '').strip().lower()
            match=re.fullmatch(r'на (\d{1,2}) (\w+)',heading); v=s.cell(r,c).value
            if not number(v): continue
            if not match or match[2] not in MONTHS: raise ValueError('Unknown weekly heading '+heading)
            date=dt.date(int(s.title),MONTHS.index(match[2])+1,int(match[1])).isoformat()
            if date<=today: weekly.append(cell_record(s,r,c,v,retail,date=date,unit='RUB/kg'))
    weekly.sort(key=lambda r:r['date'])
    if len({r['date'] for r in weekly})!=len(weekly): raise ValueError('Duplicate retail date')
    if len(monthly)<60 or len(annual)<15 or len(weekly)<200: raise ValueError('Unexpectedly short history')
    return {'schema':1,'collectedAt':today,'crop':'onion','geography':'Российская Федерация',
      'sources':[prod,retail],
      'producer':{'label':'РФ · цена производителей сельхозорганизаций','frequency':'monthly','vat':'excluded',
        'basis':'Без транспортировки, экспедирования, погрузки и разгрузки',
        'population':'Сельскохозяйственные организации; не все категории хозяйств',
        'monthly':monthly,'annual':annual,'regional':regional},
      'retail':{'label':'РФ · потребительская цена','frequency':'weekly','vat':'as_published_consumer_price','weekly':weekly},
      'limitations':['Не цена конкретной партии на складе Волгограда; не опт Москвы.',
        'Последняя пересмотренная версия: даты первоначальных публикаций не установлены. Историческая проверка не является проверкой реального времени.',
        'Региональные пропуски и конфиденциальные значения не заменены нулями. Волгоградский ряд не найден в таблицах 2025–2026.',
        'С 2022 г. учитывать территориальные оговорки и изменения состава наблюдаемых организаций; средняя цена зависит от состава продаж.',
        'Номинальные цены; годовые средние не являются декабрьскими ценами или оценкой реальной маржи.']}

def acreage(today):
    # This sparse table is kept separate from annual prices; no invented missing years/yields.
    path=RAW/'R-03-2025.docx'; archive=RAW/'S_x_2025.rar'
    source={'id':'rosstat-agriculture-2025','url':'https://rosstat.gov.ru/storage/mediabank/S_x_2025.rar',
            'indexUrl':'https://rosstat.gov.ru/folder/210/document/13226','sha256':sha(archive.read_bytes()),
            'file':str(archive.relative_to(ROOT)),'extractedFile':str(path.relative_to(ROOT)),
            'extractedSha256':sha(path.read_bytes()),'publishedDate':None,'retrievedDate':today,
            'vintage':'2025_yearbook','originalReleaseDatesKnown':False}
    with ZipFile(path) as z: root=ET.fromstring(z.read('word/document.xml'))
    ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
    previous=''
    for element in root.find('w:body',ns):
        text=''.join(element.itertext())
        if element.tag.endswith('}tbl') and previous.startswith('3.3.') and 'тысяч гектаров' in previous:
            rows=[[''.join(c.itertext()).strip() for c in r.findall('w:tc',ns)] for r in element.findall('w:tr',ns)]
            row=next(r for r in rows if r[0]=='лук репчатый')
            result=[{'year':int(y),'areaHa':float(v.replace(',','.'))*1000,'rawValue':v,'rawUnit':'thousand_ha',
                     'sourceId':source['id'],'table':'3.3','availableDate':today} for y,v in zip(rows[0][1:],row[1:])]
            if len(result)!=6: raise ValueError('Unexpected acreage table')
            return source,result
        previous=text
    raise ValueError('Acreage table not found')

def main():
    p=argparse.ArgumentParser();p.add_argument('--download',action='store_true');p.add_argument('--as-of',default=dt.date.today().isoformat());a=p.parse_args()
    dt.date.fromisoformat(a.as_of)
    index=fetch(PAGE).decode('utf-8') if a.download else (RAW/'price-index-2026-10-29.html').read_text()
    result=extract(index,a.as_of,a.download)
    area_source,area_rows=acreage(a.as_of)
    result['sources'].append(area_source)
    result['acreage']={'rows':area_rows,'population':'Все категории хозяйств','note':'Таблица округлена до тысяч гектаров; пропущенные годы не восстановлены. Не урожайность и не товарный урожай.'}
    # Save only after every series passed validation. Retain each downloaded vintage.
    if a.download: (RAW/f'price-index-{a.as_of}.html').write_text(index)
    out=ROOT/'data/official-history.json';temp=out.with_suffix('.tmp');temp.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');temp.replace(out)
    print(json.dumps({'producerMonths':len(result['producer']['monthly']),'annualYears':len(result['producer']['annual']),
                     'retailWeeks':len(result['retail']['weekly']),'latestProducer':result['producer']['monthly'][-1],
                     'latestRetail':result['retail']['weekly'][-1]},ensure_ascii=False))
if __name__=='__main__': main()
