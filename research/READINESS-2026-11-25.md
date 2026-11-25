# November 25 identity readiness fix

The fresh 14-game NHL slate produced forecasts for every game. Vancouver–Detroit was incorrectly betting-blocked because two current NHL players share the name Elias Pettersson. The injury report specifies C; current roster IDs distinguish forward 8480012 from defenseman 8483678.

Injury matching now combines normalized name, forward/defense position family and current official roster identity. Expected OUT lineups exclude the resolved player ID, so an uncertain forward being tested OUT does not also exclude the same-named defenseman. Missing position or duplicate same-position identities still fail closed; no player is guessed. Prediction rates, bet probability/EV/score/depth rules and the supported lineup formations remain unchanged.

Fresh current input replay resolved the forward and removed the false Vancouver blocker. Colorado still lacks verified available depth for a supported 12F/6D or 11F/7D formation; that distinct issue is not bypassed. All forecasts remain visible. Tests cover the actual forward/defense collision and unresolved same-position collisions, alongside the full existing skater and availability suites. No Discord messages were posted by this validation.
