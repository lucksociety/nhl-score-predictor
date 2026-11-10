import copy, tempfile, unittest
from pathlib import Path
from datetime import datetime,timezone
import bet_learning as b

class BetLearningTests(unittest.TestCase):
    def row(self,event='G',at='2026-11-06T20:00:00Z',bet=True):
        x={'type':'spreads','index':1,'side':'away','line':2.5,'label':'POR +2.5','probability':.6,'cost':.5} if bet else None
        return b.make_record(event,'2026-11-07T03:00:00Z','model',x,'verified-run',at)
    def test_actual_handicap_and_total_results_not_winner_accuracy(self):
        self.assertFalse(b.settle(self.row()['bet'],[124,118]))
        self.assertTrue(b.settle({'type':'spreads','index':1,'line':1.5},[3,5]))
        self.assertFalse(b.settle({'type':'spreads','index':1,'line':1.5},[3,1])) # KC +1.5 vs T1 3-1
        self.assertFalse(b.settle({'type':'totals','index':0,'side':'under','line':226.5},[139,132]))
    def test_postgame_records_are_excluded(self):
        self.assertIsNone(self.row(at='2026-11-07T03:00:00Z'))
        self.assertIsNone(self.row(at='2026-11-07T04:00:00Z'))
    def test_latest_no_bet_supersedes_prior_pick_and_duplicates_do_not_count(self):
        first=self.row();last=self.row(at='2026-11-06T22:00:00Z',bet=False)
        r=b.evaluate(b.merge([first,first,last]),{'G':{'scores':[124,118]}})
        self.assertEqual(r['settled_by_model_and_market'],{})
    def test_modified_archive_rejected(self):
        r=self.row();r['bet']['probability']=.9
        with self.assertRaises(AssertionError):b.merge([r])
    def test_conditional_games_and_pushes_not_false_losses(self):
        self.assertIsNone(b.settle({'type':'game','index':1},[3,0]))
        self.assertIsNone(b.settle({'type':'totals','index':0,'side':'under','line':6},[4,2]))
    def test_reliability_and_profit_are_separate(self):
        r=b.evaluate([self.row()],{'G':{'scores':[124,118]}})
        group=next(iter(r['settled_by_model_and_market'].values()))
        self.assertEqual(group['wins'],0);self.assertEqual(group['flat_cost_roi'],-1)
        self.assertAlmostEqual(group['brier'],.36)
    def test_nhl_unverified_execution_is_not_captured_as_a_delivered_bet(self):
        import json,os
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);folder=root/'data/predictions';folder.mkdir(parents=True)
            pick={'type':'PUCKLINE','label':'A +1.5','q':.7,'cost':.6,'executionVerified':False}
            game={'id':'G','away':'A','home':'H','start':'2099-01-01T14:00:00Z','quoteFetchedAt':'2099-01-01T12:00:00Z','best':pick}
            doc={'model':'test','selectionPolicy':'scoring-quote-fee-depth-v2','games':[game]}
            with patch.dict(os.environ,{'SLATE_DATE':'2099-01-01'}):
                path=folder/'2099-01-01.json';path.write_text(json.dumps(doc))
                rows=b.capture(root,'nhl-score-predictor','2099-01-01T12:01:00Z','test')
                self.assertIsNone(rows[0]['bet']);self.assertEqual(rows[0]['selection_policy'],'scoring-quote-fee-depth-v2')
                pick['executionVerified']=True;path.write_text(json.dumps(doc))
                rows=b.capture(root,'nhl-score-predictor','2099-01-01T12:01:00Z','test')
                self.assertEqual(rows[0]['bet']['label'],'A +1.5')

if __name__=='__main__':unittest.main()
