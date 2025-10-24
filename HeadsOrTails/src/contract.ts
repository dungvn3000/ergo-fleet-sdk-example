
export const gameScript = `
 { // Get inputs from the createGameTransaction, this is the last box in the input list
   val p2Choice = INPUTS(INPUTS.size-1).R4[Coll[Byte]].get
   val p1AnswerHash = INPUTS(INPUTS.size-1).R5[Coll[Byte]].get
   val player1Pk = INPUTS(INPUTS.size-1).R6[SigmaProp].get
   val partyPrice = INPUTS(INPUTS.size-1).R7[Long].get
   val gameEnd = INPUTS(INPUTS.size-1).R8[Int].get
   
   // Get the outputs register
   val p1Choice = OUTPUTS(0).R4[Coll[Byte]].get
   val p1Secret = OUTPUTS(0).R5[Coll[Byte]].get
   
   // Compute the winner (the check of the correctness of the winner answer is done later)
   val p1win = ( p2Choice != p1Choice )
   
   sigmaProp (
    // After the end of the game the second player wins by default
    // This prevents the first player to block to game by not relealing its answer and secret
     (player2Pk && HEIGHT > gameEnd) || 
       allOf(Coll(
         // The hash of the first player answer must match
         blake2b256(p1Secret ++ p1Choice) == p1AnswerHash,
         // The winner can withdraw
  			 (player1Pk && p1win) || (player2Pk && (p1win == false))
       ))
   )
  }
`

export const createGameScript = `
  {
    val gameScriptHash = SELF.R4[Coll[Byte]].get
    val p1AnswerHash = SELF.R5[Coll[Byte]].get

    sigmaProp (
      (player1Pk && HEIGHT > gameEnd) ||
          allOf(Coll(
              player2Pk,
              blake2b256(OUTPUTS(0).propositionBytes) == gameScriptHash,
              OUTPUTS(0).value >= 2 * partyPrice,
              OUTPUTS(0).R5[Coll[Byte]].get == p1AnswerHash,
              OUTPUTS(0).R6[SigmaProp].get == player1Pk,
              OUTPUTS(0).R7[Long].get == partyPrice,
              OUTPUTS(0).R8[Int].get == gameEnd
            ))
    )
  }
`