using UnityEngine;

[CreateAssetMenu(fileName = "LevelData", menuName = "Game/Data/LevelData", order = 1)]
public class LevelData : ScriptableObject
{
    public float[] hpMultipliers = { 1.0f, 1.12f, 1.25f, 1.4f, 1.57f };
    public float[] attackMultipliers = { 1.0f, 1.09f, 1.19f, 1.3f, 1.42f };
    public float[] speedIncrements = { 0f, 0.9f, 1.8f, 2.7f, 3.6f };
    public float[] rangeIncrements = { 0f, 1.8f, 3.6f, 5.4f, 7.2f };
    public int[] monstersPerLevel = { 3, 6, 10 };
    public int[] timeLimitsSeconds = { 30, 90, 120 };
    public float[] defenseMultiplier = { 1.2f, 1.3f, 1.4f };
}
