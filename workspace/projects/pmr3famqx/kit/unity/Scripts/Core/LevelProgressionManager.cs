using UnityEngine;

public class LevelProgressionManager : MonoBehaviour
{
    public int currentLevel = 1;
    public int roundsCleared = 0;
    public int roundsToClearForUpgrade = 3;
    public float itemDropRateBonus = 0.15f;

    public event System.Action<int> OnLevelUp;
    public event System.Action OnRoundCleared;

    private void Start() => LoadLevelData();

    private void LoadLevelData()
    {
        // TODO: Resources.Load<LevelData>("Data/LevelData") 및 초기화
    }

    public void IncrementRounds()
    {
        roundsCleared++;
        if (roundsCleared >= roundsToClearForUpgrade)
        {
            currentLevel++;
            roundsCleared = 0;
            OnLevelUp?.Invoke(currentLevel);
        }
        OnRoundCleared?.Invoke();
    }

    public float GetItemDropRate()
    {
        // TODO: 기본값 + (currentLevel - 1) * itemDropRateBonus 계산
        return 1.0f;
    }

    public float GetMovementSpeed()
    {
        // TODO: LevelData 기반 이동속도 계산 (공식: 80 + 0.9*(Lv-1) + max(0,1.5*(Lv-30)))
        return 80f;
    }
}
