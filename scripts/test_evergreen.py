import importlib.util,json,pathlib,tempfile,unittest,sys
ROOT=pathlib.Path(__file__).resolve().parents[1]
def module(path,name):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

class ArchiveTests(unittest.TestCase):
    def test_captures_are_market_free(self):
        m=module(ROOT/'scripts/model_learning.py','learning_test')
        rows,_=m.collect_local(ROOT,json.loads((ROOT/'learning/config.json').read_text())['project'])
        for row in rows:
            self.assertEqual(set(row),{'event_id','start','frozen_at','model','probabilities','labels','source','cutoff','key','schema_version','expected_scores'})
            self.assertLess(m.timestamp(row['frozen_at']),m.timestamp(row['start']))

class SeasonTests(unittest.TestCase):
    def test_nhl_rollover_and_failure_preserve_data(self):
        from datetime import date
        from unittest.mock import patch
        m=module(ROOT/'scripts/update_data.py','nhl_update')
        self.assertEqual(m.season_start(date(2027,2,1)).year,2026)
        self.assertEqual(m.season_start(date(2027,10,1)).year,2027)
        with tempfile.TemporaryDirectory() as d:
            old=pathlib.Path(d)/'results_2026_27.json';old.write_text('[]')
            payload={'gameWeek':[{'date':'2027-09-30','games':[{'id':2027020001,'gameType':2,'gameState':'FINAL','awayTeam':{'score':2,'abbrev':'BOS'},'homeTeam':{'score':3,'abbrev':'NYR'}}]}]}
            with patch.object(m,'DATA',d),patch.object(m,'get',return_value=payload):m.update_results(date(2027,10,1))
            self.assertEqual(json.loads(old.read_text()),[])
            self.assertEqual(len(json.loads((pathlib.Path(d)/'results_2027_28.json').read_text())),1)
            before=(pathlib.Path(d)/'results_current.json').read_text()
            with patch.object(m,'DATA',d),patch.object(m,'get',return_value=None):
                with self.assertRaises(RuntimeError):m.update_results(date(2027,10,2))
            self.assertEqual((pathlib.Path(d)/'results_current.json').read_text(),before)
